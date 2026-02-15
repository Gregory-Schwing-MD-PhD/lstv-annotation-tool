/**
 * Dual-View DICOM Viewer - CODEC FIXED VERSION
 * Fixes: "decodeTask is undefined" and Web Worker initialization errors.
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

        if (!this.axialElement || !this.sagittalElement) return;
        this.init();
    }

    async init() {
        try {
            if (typeof cornerstoneWADOImageLoader !== 'undefined') {
                cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
                cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

                // CRITICAL FIX: Direct configuration for Web Workers
                // This prevents the "decodeTask is undefined" error by providing a default config
                const config = {
                    webWorkerPath: 'https://unpkg.com/cornerstone-wado-image-loader@4.1.3/dist/cornerstoneWADOImageLoaderWebWorker.bundle.min.js',
                    taskConfiguration: {
                        'decodeTask': {
                            initializeCodecsOnDemand: true,
                            usePDFJS: false,
                            strict: false
                        }
                    }
                };
                
                // Only initialize if not already running
                if (!cornerstoneWADOImageLoader.webWorkerManager.isInitialized()) {
                    cornerstoneWADOImageLoader.webWorkerManager.initialize(config);
                }
            }
            
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            console.log('✓ Dual DICOM Viewer initialized (Codecs Configured)');
        } catch (error) {
            console.error('Codec Init Error:', error);
        }
    }

    // Keep resize logic to handle the "White Screen"
    resize() {
        console.log('⚡ Resize Triggered');
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

        // Use requestAnimationFrame for clean line rendering
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
        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);
    }

    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        this.currentAxialIndex = index;
        try {
            const image = await cornerstone.loadAndCacheImage(this.axialImageIds[index].id);
            this.axialElement.style.width = image.width + 'px';
            this.axialElement.style.height = image.height + 'px';
            cornerstone.displayImage(this.axialElement, image);
            const vp = cornerstone.getViewport(this.axialElement);
            vp.scale = 1.0; 
            cornerstone.setViewport(this.axialElement, vp);
        } catch (e) { console.error(e); }
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        this.currentSagittalIndex = index;
        try {
            const image = await cornerstone.loadAndCacheImage(this.sagittalImageIds[index].id);
            this.sagittalElement.style.width = image.width + 'px';
            this.sagittalElement.style.height = image.height + 'px';
            cornerstone.displayImage(this.sagittalElement, image);
            const vp = cornerstone.getViewport(this.sagittalElement);
            vp.scale = 1.0;
            cornerstone.setViewport(this.sagittalElement, vp);
        } catch (e) { console.error(e); }
    }

    drawCrosshairOnAxial(ctx) {
        if (!this.sagittalMetadata.length || !this.axialMetadata[this.currentAxialIndex]) return;
        const proj = this.projectPointToSlice(this.sagittalMetadata[this.currentSagittalIndex].position, this.axialMetadata[this.currentAxialIndex]);
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, proj);
            if (canvasPoint.x >= 0 && canvasPoint.x <= ctx.canvas.width) {
                ctx.save(); ctx.beginPath(); ctx.strokeStyle = '#00ff00'; ctx.setLineDash([5, 5]);
                ctx.moveTo(canvasPoint.x, 0); ctx.lineTo(canvasPoint.x, ctx.canvas.height);
                ctx.stroke(); ctx.restore();
            }
        }
    }

    drawCrosshairOnSagittal(ctx) {
        if (!this.axialMetadata.length || !this.sagittalMetadata[this.currentSagittalIndex]) return;
        const proj = this.projectPointToSlice(this.axialMetadata[this.currentAxialIndex].position, this.sagittalMetadata[this.currentSagittalIndex]);
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, proj);
            if (canvasPoint.y >= 0 && canvasPoint.y <= ctx.canvas.height) {
                ctx.save(); ctx.beginPath(); ctx.strokeStyle = '#00ff00'; ctx.setLineDash([5, 5]);
                ctx.moveTo(0, canvasPoint.y); ctx.lineTo(ctx.canvas.width, canvasPoint.y);
                ctx.stroke(); ctx.restore();
            }
        }
    }

    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.spacing) return null;
        const [px, py, pz] = worldPoint;
        const [sx, sy, sz] = sliceMetadata.position;
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;
        const dx = px - sx; const dy = py - sy; const dz = pz - sz;
        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        const mmY = dx * colX + dy * colY + dz * colZ;
        return { x: mmX / colSpacing, y: mmY / rowSpacing };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        this.clear();
        await Promise.all([this.loadAxialSeries(axialFiles), this.loadSagittalSeries(sagittalFiles)]);
        await this.displayAxialImage(Math.floor(this.axialImageIds.length / 2));
        await this.displaySagittalImage(Math.floor(this.sagittalImageIds.length / 2));
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
            const blob = new Blob([file.data], { type: 'application/dicom' });
            const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
            const metadata = await this.extractDicomMetadata(imageId);
            return { id: imageId, metadata };
        });
        return (await Promise.all(promises)).filter(x => x !== null);
    }

    async extractDicomMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            return {
                position: image.imagePositionPatient,
                orientation: [...image.rowCosines, ...image.columnCosines],
                spacing: [image.rowPixelSpacing, image.columnPixelSpacing]
            };
        } catch (e) { return null; }
    }

    setupWindowLevel(element) {
        let isDragging = false; let startX, startY, startWL, startWW;
        element.addEventListener('mousedown', (e) => {
            isDragging = true; startX = e.clientX; startY = e.clientY;
            const vp = cornerstone.getViewport(element);
            if (vp) { startWL = vp.voi.windowCenter; startWW = vp.voi.windowWidth; }
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const vp = cornerstone.getViewport(element);
            if (vp) {
                vp.voi.windowCenter = startWL + (e.clientY - startY);
                vp.voi.windowWidth = Math.max(1, startWW + (e.clientX - startX));
                cornerstone.setViewport(element, vp);
            }
        });
        document.addEventListener('mouseup', () => isDragging = false);
    }

    async nextAxialImage() { if (this.currentAxialIndex < this.axialImageIds.length - 1) { await this.displayAxialImage(this.currentAxialIndex + 1); this.updateSliceInfo(); cornerstone.updateImage(this.sagittalElement); } }
    async previousAxialImage() { if (this.currentAxialIndex > 0) { await this.displayAxialImage(this.currentAxialIndex - 1); this.updateSliceInfo(); cornerstone.updateImage(this.sagittalElement); } }
    async nextSagittalImage() { if (this.currentSagittalIndex < this.sagittalImageIds.length - 1) { await this.displaySagittalImage(this.currentSagittalIndex + 1); this.updateSliceInfo(); cornerstone.updateImage(this.axialElement); } }
    async previousSagittalImage() { if (this.currentSagittalIndex > 0) { await this.displaySagittalImage(this.currentSagittalIndex - 1); this.updateSliceInfo(); cornerstone.updateImage(this.axialElement); } }

    updateSliceInfo() {
        document.getElementById('axialSlice').textContent = this.currentAxialIndex + 1;
        document.getElementById('axialTotal').textContent = this.axialImageIds.length;
        document.getElementById('sagittalSlice').textContent = this.currentSagittalIndex + 1;
        document.getElementById('sagittalTotal').textContent = this.sagittalImageIds.length;
    }

    getCurrentSlices() { return { axial: this.currentAxialIndex + 1, sagittal: this.currentSagittalIndex + 1 }; }
    clear() { this.axialImageIds = []; this.sagittalImageIds = []; this.currentAxialIndex = 0; this.currentSagittalIndex = 0; }
}
let dicomViewer = null;
