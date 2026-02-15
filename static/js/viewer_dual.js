/**
 * Dual-View DICOM Viewer - DIRECT DRAW ARCHITECTURE
 * * FIXES:
 * 1. "White Screen" -> Fixed by adding resize() method.
 * 2. "No Images" -> Fixed by removing broken Overlay Canvases.
 * 3. "Infinite Loop" -> Fixed by removing updateImage() from inside draw functions.
 * 4. "Canvas Context" -> Fixed event handler to properly access canvas context.
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
            console.error('Viewer elements not found!');
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
            
            // Enable elements (Create the internal canvas)
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized (Direct Draw Mode)');
        } catch (error) {
            console.error('Error initializing dual viewer:', error);
        }
    }

    /**
     * PUBLIC RESIZE METHOD
     * Required by app_dual.js to fix the 0x0 White Canvas bug
     */
    resize() {
        console.log('⚡ Manual Resize Triggered');
        
        // 1. Tell Cornerstone the container size changed
        cornerstone.resize(this.axialElement, true);
        cornerstone.resize(this.sagittalElement, true);

        // 2. Force a redraw of the medical images
        if (this.axialImageIds.length) {
            cornerstone.updateImage(this.axialElement);
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    setupEventListeners() {
        // Scroll Listeners
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.deltaY < 0 ? this.previousAxialImage() : this.nextAxialImage();
        });

        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.deltaY < 0 ? this.previousSagittalImage() : this.nextSagittalImage();
        });

        // *** FIX: Correct way to access canvas context ***
        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            const canvas = this.axialElement.querySelector('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                this.drawCrosshairOnAxial(ctx);
            }
        });

        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                this.drawCrosshairOnSagittal(ctx);
            }
        });
        
        // Window Resize
        window.addEventListener('resize', () => this.resize());
        
        // Keyboard Support
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
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.spacing) return null;
        
        const [px, py, pz] = worldPoint;
        const [sx, sy, sz] = sliceMetadata.position;
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;

        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;

        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        const mmY = dx * colX + dy * colY + dz * colZ;

        return { x: mmX / colSpacing, y: mmY / rowSpacing };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        this.clear();
        console.log(`Loading: ${axialFiles.length} Ax, ${sagittalFiles.length} Sag`);
        
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);

        const midAx = Math.floor(this.axialImageIds.length / 2);
        const midSag = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(midAx),
            this.displaySagittalImage(midSag)
        ]);
        
        this.updateSliceInfo();
        
        // Safety resize shortly after load
        setTimeout(() => this.resize(), 100);
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
        const image = await cornerstone.loadAndCacheImage(this.axialImageIds[index].id);
        cornerstone.displayImage(this.axialElement, image);
        // NO updateCrosshairs() call here - cornerstone.displayImage triggers the event automatically
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        this.currentSagittalIndex = index;
        const image = await cornerstone.loadAndCacheImage(this.sagittalImageIds[index].id);
        cornerstone.displayImage(this.sagittalElement, image);
    }

    /**
     * DRAW LOGIC: Direct Canvas Access
     * We receive the canvasContext directly from the event handler
     */
    drawCrosshairOnAxial(ctx) {
        if (!this.sagittalMetadata.length) return;
        
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        
        // Project Sagittal Origin (X-plane) onto Axial
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (proj) {
            // Map pixel coordinates to canvas coordinates (handles zoom/pan/resize)
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, { x: proj.x, y: proj.y });
            
            const width = this.axialElement.clientWidth;
            
            // Bounds Check: Only draw if X is visible
            if (canvasPoint.x >= 0 && canvasPoint.x <= width) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                // Vertical line at calculated X
                ctx.moveTo(canvasPoint.x, 0);
                ctx.lineTo(canvasPoint.x, this.axialElement.clientHeight);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    drawCrosshairOnSagittal(ctx) {
        if (!this.axialMetadata.length) return;
        
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        
        // Project Axial Origin (Z-plane) onto Sagittal
        const proj = this.projectPointToSlice(axMeta.position, sagMeta);
        
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, { x: proj.x, y: proj.y });
            
            const height = this.sagittalElement.clientHeight;
            
            // Bounds Check: Only draw if Y is visible
            if (canvasPoint.y >= 0 && canvasPoint.y <= height) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                // Horizontal line at calculated Y
                ctx.moveTo(0, canvasPoint.y);
                ctx.lineTo(this.sagittalElement.clientWidth, canvasPoint.y);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
            // Trigger sagittal update (to move its crosshair)
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
            // Trigger axial update (to move its crosshair)
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
