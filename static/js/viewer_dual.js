/**
 * Dual-View DICOM Viewer - FIXED VERSION
 * 
 * KEY FIXES:
 * 1. Use cornerstone.pixelToCanvas() correctly - it handles all viewport transforms
 * 2. Don't manipulate viewport.scale - let Cornerstone fit images naturally
 * 3. Draw crosshairs AFTER image is rendered via event
 * 4. Proper coordinate system: {x: column, y: row}
 */

class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        this.axialMetadata = [];   
        this.sagittalMetadata = [];
        
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;
        this.isInitialized = false;
        
        if (!this.axialElement || !this.sagittalElement) {
            console.error('❌ Viewer elements not found!');
            return;
        }
        
        this.init();
    }

    init() {
        try {
            if (typeof cornerstoneWADOImageLoader !== 'undefined') {
                cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
                cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
            }
            
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized');
        } catch (error) {
            console.error('❌ Error initializing dual viewer:', error);
        }
    }

    resize() {
        console.log('⚡ Resize triggered');
        
        cornerstone.resize(this.axialElement, true);
        cornerstone.resize(this.sagittalElement, true);

        if (this.axialImageIds.length) {
            cornerstone.updateImage(this.axialElement);
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    setupEventListeners() {
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.deltaY < 0 ? this.previousAxialImage() : this.nextAxialImage();
        });

        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.deltaY < 0 ? this.previousSagittalImage() : this.nextSagittalImage();
        });

        // CRITICAL: Draw crosshairs AFTER Cornerstone renders the image
        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            requestAnimationFrame(() => {
                const canvas = this.axialElement.querySelector('canvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    this.drawCrosshairOnAxial(ctx);
                }
            });
        });

        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            requestAnimationFrame(() => {
                const canvas = this.sagittalElement.querySelector('canvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    this.drawCrosshairOnSagittal(ctx);
                }
            });
        });
        
        window.addEventListener('resize', () => this.resize());
        
        document.addEventListener('keydown', (e) => {
            if (this.axialImageIds.length === 0) return;
            if (e.key === 'ArrowUp') this.previousAxialImage();
            else if (e.key === 'ArrowDown') this.nextAxialImage();
            else if (e.key === 'ArrowLeft') this.previousSagittalImage();
            else if (e.key === 'ArrowRight') this.nextSagittalImage();
        });

        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);
    }

    setupWindowLevel(element) {
        let startX, startY, startWL, startWW;
        let isDragging = false;

        element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            try {
                const vp = cornerstone.getViewport(element);
                startWL = vp.voi.windowCenter;
                startWW = vp.voi.windowWidth;
            } catch (e) {}
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            try {
                const vp = cornerstone.getViewport(element);
                vp.voi.windowCenter = startWL + deltaY;
                vp.voi.windowWidth = Math.max(1, startWW + deltaX);
                cornerstone.setViewport(element, vp);
            } catch (e) {}
        });
        document.addEventListener('mouseup', () => isDragging = false);
    }

    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.spacing || !sliceMetadata.orientation) {
            return null;
        }
        
        const [px, py, pz] = worldPoint;
        const [sx, sy, sz] = sliceMetadata.position;
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;

        // Vector from slice origin to point
        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;

        // Project onto row direction (gives distance in mm along rows)
        const mmAlongRows = dx * rowX + dy * rowY + dz * rowZ;
        // Project onto column direction (gives distance in mm along columns)
        const mmAlongCols = dx * colX + dy * colY + dz * colZ;

        // Convert mm to pixels
        // NOTE: rowSpacing is the spacing between ROWS (vertical spacing)
        //       colSpacing is the spacing between COLUMNS (horizontal spacing)
        const pixelColumn = mmAlongRows / colSpacing;  // X coordinate
        const pixelRow = mmAlongCols / rowSpacing;     // Y coordinate

        return { x: pixelColumn, y: pixelRow };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        this.clear();
        console.log(`📥 Loading: ${axialFiles.length} Ax, ${sagittalFiles.length} Sag`);
        
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);

        console.log(`✓ Metadata loaded`);

        const midAx = Math.floor(this.axialImageIds.length / 2);
        const midSag = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(midAx),
            this.displaySagittalImage(midSag)
        ]);
        
        console.log(`✓ Images displayed`);
        
        this.updateSliceInfo();
        
        setTimeout(() => this.resize(), 150);
    }

    async loadAxialSeries(files) {
        const results = await this.processFiles(files);
        results.sort((a, b) => b.metadata.position[2] - a.metadata.position[2]);
        this.axialImageIds = results.map(r => ({ id: r.id }));
        this.axialMetadata = results.map(r => r.metadata);
    }

    async loadSagittalSeries(files) {
        const results = await this.processFiles(files);
        results.sort((a, b) => a.metadata.position[0] - b.metadata.position[0]);
        this.sagittalImageIds = results.map(r => ({ id: r.id }));
        this.sagittalMetadata = results.map(r => r.metadata);
    }

    async processFiles(files) {
        const promises = files.map(async (file) => {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                const metadata = await this.extractDicomMetadata(imageId);
                return { id: imageId, filename: file.filename, metadata };
            } catch (e) { return null; }
        });
        return (await Promise.all(promises)).filter(x => x !== null);
    }

    async extractDicomMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            let meta = {
                position: image.imagePositionPatient,
                orientation: null,
                spacing: [image.rowPixelSpacing, image.columnPixelSpacing],
                rows: image.rows,
                columns: image.columns
            };
            if (image.rowCosines) meta.orientation = [...image.rowCosines, ...image.columnCosines];
            
            if ((!meta.position || !meta.orientation) && image.data && image.data.string) {
                const ipp = image.data.string('x00200032');
                const iop = image.data.string('x00200037');
                if (ipp) meta.position = ipp.split('\\').map(parseFloat);
                if (iop) meta.orientation = iop.split('\\').map(parseFloat);
            }
            return meta;
        } catch (e) {
            return { position: [0,0,0], orientation: [1,0,0,0,1,0], spacing: [1,1] };
        }
    }

    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        
        this.currentAxialIndex = index;
        
        try {
            const image = await cornerstone.loadAndCacheImage(this.axialImageIds[index].id);
            cornerstone.displayImage(this.axialElement, image);
            // Don't call updateImage here - displayImage already triggers cornerstoneimagerendered
        } catch (error) {
            console.error('❌ Error displaying axial:', error);
        }
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        
        this.currentSagittalIndex = index;
        
        try {
            const image = await cornerstone.loadAndCacheImage(this.sagittalImageIds[index].id);
            cornerstone.displayImage(this.sagittalElement, image);
        } catch (error) {
            console.error('❌ Error displaying sagittal:', error);
        }
    }

    drawCrosshairOnAxial(ctx) {
        if (!this.sagittalMetadata.length || !this.axialMetadata.length) return;
        
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        
        // Project the sagittal slice position onto the axial image
        const pixelCoords = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (!pixelCoords) return;
        
        // Convert pixel coordinates to canvas coordinates
        // cornerstone.pixelToCanvas handles zoom, pan, rotation automatically
        const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, pixelCoords);
        
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        
        // Draw vertical line (X position from sagittal)
        if (canvasPoint.x >= 0 && canvasPoint.x <= canvasWidth) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(canvasPoint.x, 0);
            ctx.lineTo(canvasPoint.x, canvasHeight);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawCrosshairOnSagittal(ctx) {
        if (!this.axialMetadata.length || !this.sagittalMetadata.length) return;
        
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        
        // Project the axial slice position onto the sagittal image
        const pixelCoords = this.projectPointToSlice(axMeta.position, sagMeta);
        
        if (!pixelCoords) return;
        
        // Convert pixel coordinates to canvas coordinates
        const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, pixelCoords);
        
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        
        // Draw horizontal line (Y position from axial)
        if (canvasPoint.y >= 0 && canvasPoint.y <= canvasHeight) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(0, canvasPoint.y);
            ctx.lineTo(canvasWidth, canvasPoint.y);
            ctx.stroke();
            ctx.restore();
        }
    }

    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
            // Trigger sagittal redraw to update its crosshair
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    async previousAxialImage() {
        if (this.currentAxialIndex > 0) {
            await this.displayAxialImage(this.currentAxialIndex - 1);
            this.updateSliceInfo();
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    async nextSagittalImage() {
        if (this.currentSagittalIndex < this.sagittalImageIds.length - 1) {
            await this.displaySagittalImage(this.currentSagittalIndex + 1);
            this.updateSliceInfo();
            // Trigger axial redraw to update its crosshair
            cornerstone.updateImage(this.axialElement);
        }
    }

    async previousSagittalImage() {
        if (this.currentSagittalIndex > 0) {
            await this.displaySagittalImage(this.currentSagittalIndex - 1);
            this.updateSliceInfo();
            cornerstone.updateImage(this.axialElement);
        }
    }

    updateSliceInfo() {
        try {
            document.getElementById('axialSlice').textContent = this.currentAxialIndex + 1;
            document.getElementById('axialTotal').textContent = this.axialImageIds.length;
            document.getElementById('sagittalSlice').textContent = this.currentSagittalIndex + 1;
            document.getElementById('sagittalTotal').textContent = this.sagittalImageIds.length;
        } catch(e) {}
    }

    resetWindowLevel() {
        cornerstone.reset(this.axialElement);
        cornerstone.reset(this.sagittalElement);
    }
    
    getCurrentSlices() {
        return { axial: this.currentAxialIndex + 1, sagittal: this.currentSagittalIndex + 1 };
    }

    clear() {
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        this.axialMetadata = [];
        this.sagittalMetadata = [];
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;
        
        if (this.isInitialized) {
            try {
                cornerstone.reset(this.axialElement);
                cornerstone.reset(this.sagittalElement);
            } catch (error) {}
        }
    }
}
let dicomViewer = null;
