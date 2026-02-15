/**
 * Dual-View DICOM Viewer - STABLE DIRECT-DRAW VERSION
 * Fixes: Decoding workers, Viewport initialization, and Resize Race Conditions.
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
                
                // Initialize Web Workers - CRITICAL for decoding images
                const config = {
                    maxWebWorkers: navigator.hardwareConcurrency || 4,
                    startWebWorkersOnDemand: true,
                    taskConfiguration: {
                        decodeTask: { initializeCodecsOnDemand: true }
                    }
                };
                cornerstoneWADOImageLoader.webWorkerManager.initialize(config);
            }
            
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized (Hybrid Mode)');
        } catch (error) {
            console.error('❌ Error initializing dual viewer:', error);
        }
    }

    resize() {
        console.log('⚡ Manual Resize Triggered');
        
        // Force height via JS to be 100% sure
        this.axialElement.style.height = '600px';
        this.sagittalElement.style.height = '600px';

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

        // Use requestAnimationFrame to ensure crosshair draws AFTER image
        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            requestAnimationFrame(() => {
                const canvas = this.axialElement.querySelector('canvas');
                if (canvas) this.drawCrosshairOnAxial(canvas.getContext('2d'));
            });
        });

        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            requestAnimationFrame(() => {
                const canvas = this.sagittalElement.querySelector('canvas');
                if (canvas) this.drawCrosshairOnSagittal(canvas.getContext('2d'));
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
        let isDragging = false;
        let startX, startY, startWL, startWW;

        element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const vp = cornerstone.getViewport(element);
            startWL = vp.voi.windowCenter;
            startWW = vp.voi.windowWidth;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const vp = cornerstone.getViewport(element);
            vp.voi.windowCenter = startWL + deltaY;
            vp.voi.windowWidth = Math.max(1, startWW + deltaX);
            cornerstone.setViewport(element, vp);
        });

        document.addEventListener('mouseup', () => isDragging = false);
    }

    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.spacing || !sliceMetadata.orientation) return null;
        
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
        
        // Parallel load metadata
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);

        const midAx = Math.floor(this.axialImageIds.length / 2);
        const midSag = Math.floor(this.sagittalImageIds.length / 2);
        
        // Sequence display to ensure canvas context is stable
        await this.displayAxialImage(midAx);
        await this.displaySagittalImage(midSag);
        
        this.updateSliceInfo();
        
        // Force the layout to snap into place
        setTimeout(() => this.resize(), 200);
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
                return { id: imageId, metadata };
            } catch (e) { return null; }
        });
        return (await Promise.all(promises)).filter(x => x !== null);
    }

    async extractDicomMetadata(imageId) {
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
    }

    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        this.currentAxialIndex = index;
        const image = await cornerstone.loadAndCacheImage(this.axialImageIds[index].id);
        cornerstone.displayImage(this.axialElement, image);
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        this.currentSagittalIndex = index;
        const image = await cornerstone.loadAndCacheImage(this.sagittalImageIds[index].id);
        cornerstone.displayImage(this.sagittalElement, image);
    }

    drawCrosshairOnAxial(ctx) {
        if (!this.sagittalMetadata.length || !this.axialMetadata.length) return;
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, proj);
            if (canvasPoint.x >= 0 && canvasPoint.x <= ctx.canvas.width) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.moveTo(canvasPoint.x, 0);
                ctx.lineTo(canvasPoint.x, ctx.canvas.height);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    drawCrosshairOnSagittal(ctx) {
        if (!this.axialMetadata.length || !this.sagittalMetadata.length) return;
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        
        const proj = this.projectPointToSlice(axMeta.position, sagMeta);
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, proj);
            if (canvasPoint.y >= 0 && canvasPoint.y <= ctx.canvas.height) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.moveTo(0, canvasPoint.y);
                ctx.lineTo(ctx.canvas.width, canvasPoint.y);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
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
