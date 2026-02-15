/**
 * Dual-View DICOM Viewer - NATURAL SIZE VERSION
 * Renders images 1:1 based on DICOM pixel dimensions.
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

    init() {
        try {
            if (typeof cornerstoneWADOImageLoader !== 'undefined') {
                cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
                cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
                cornerstoneWADOImageLoader.webWorkerManager.initialize({
                    maxWebWorkers: navigator.hardwareConcurrency || 4,
                    startWebWorkersOnDemand: true
                });
            }
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
        } catch (error) { console.error(error); }
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

        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            const canvas = this.axialElement.querySelector('canvas');
            if (canvas) this.drawCrosshairOnAxial(canvas.getContext('2d'));
        });

        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (canvas) this.drawCrosshairOnSagittal(canvas.getContext('2d'));
        });

        window.addEventListener('resize', () => this.resize());
        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);
    }

    /**
     * NATURAL SIZE LOGIC
     * Sets the div dimensions to match the image dimensions exactly.
     */
    fitContainerToImage(element, image) {
        element.style.width = image.width + 'px';
        element.style.height = image.height + 'px';
        cornerstone.resize(element);
    }

    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        this.currentAxialIndex = index;
        
        try {
            const image = await cornerstone.loadAndCacheImage(this.axialImageIds[index].id);
            
            // 1. Force container to match image pixels
            this.fitContainerToImage(this.axialElement, image);
            
            // 2. Display with scale 1.0 (Natural size)
            cornerstone.displayImage(this.axialElement, image);
            const viewport = cornerstone.getViewport(this.axialElement);
            viewport.scale = 1.0; 
            viewport.translation.x = 0;
            viewport.translation.y = 0;
            cornerstone.setViewport(this.axialElement, viewport);

        } catch (error) { console.error(error); }
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        this.currentSagittalIndex = index;
        
        try {
            const image = await cornerstone.loadAndCacheImage(this.sagittalImageIds[index].id);
            
            // 1. Force container to match image pixels
            this.fitContainerToImage(this.sagittalElement, image);
            
            // 2. Display with scale 1.0 (Natural size)
            cornerstone.displayImage(this.sagittalElement, image);
            const viewport = cornerstone.getViewport(this.sagittalElement);
            viewport.scale = 1.0;
            viewport.translation.x = 0;
            viewport.translation.y = 0;
            cornerstone.setViewport(this.sagittalElement, viewport);

        } catch (error) { console.error(error); }
    }

    // Reuse the projection math from previous versions
    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.spacing || !sliceMetadata.orientation) return null;
        const [px, py, pz] = worldPoint;
        const [sx, sy, sz] = sliceMetadata.position;
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;
        const dx = px - sx; const dy = py - sy; const dz = pz - sz;
        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        const mmY = dx * colX + dy * colY + dz * colZ;
        return { x: mmX / colSpacing, y: mmY / rowSpacing };
    }

    drawCrosshairOnAxial(ctx) {
        if (!this.sagittalMetadata.length) return;
        const proj = this.projectPointToSlice(this.sagittalMetadata[this.currentSagittalIndex].position, this.axialMetadata[this.currentAxialIndex]);
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, proj);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.setLineDash([5, 5]);
            ctx.moveTo(canvasPoint.x, 0);
            ctx.lineTo(canvasPoint.x, ctx.canvas.height);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawCrosshairOnSagittal(ctx) {
        if (!this.axialMetadata.length) return;
        const proj = this.projectPointToSlice(this.axialMetadata[this.currentAxialIndex].position, this.sagittalMetadata[this.currentSagittalIndex]);
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, proj);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.setLineDash([5, 5]);
            ctx.moveTo(0, canvasPoint.y);
            ctx.lineTo(ctx.canvas.width, canvasPoint.y);
            ctx.stroke();
            ctx.restore();
        }
    }

    resize() {
        // In Natural mode, we don't fit to window, we just ensure viewport is centered
        cornerstone.resize(this.axialElement);
        cornerstone.resize(this.sagittalElement);
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        this.axialMetadata = []; this.sagittalMetadata = [];
        await Promise.all([this.loadAxialSeries(axialFiles), this.loadSagittalSeries(sagittalFiles)]);
        await this.displayAxialImage(Math.floor(this.axialImageIds.length / 2));
        await this.displaySagittalImage(Math.floor(this.sagittalImageIds.length / 2));
        this.updateSliceInfo();
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
            const image = await cornerstone.loadImage(imageId);
            const metadata = {
                position: image.imagePositionPatient,
                orientation: [...image.rowCosines, ...image.columnCosines],
                spacing: [image.rowPixelSpacing, image.columnPixelSpacing]
            };
            return { id: imageId, metadata };
        });
        return Promise.all(promises);
    }

    setupWindowLevel(element) {
        let isDragging = false; let startX, startY, startWL, startWW;
        element.addEventListener('mousedown', (e) => {
            isDragging = true; startX = e.clientX; startY = e.clientY;
            const vp = cornerstone.getViewport(element);
            startWL = vp.voi.windowCenter; startWW = vp.voi.windowWidth;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const vp = cornerstone.getViewport(element);
            vp.voi.windowCenter = startWL + (e.clientY - startY);
            vp.voi.windowWidth = Math.max(1, startWW + (e.clientX - startX));
            cornerstone.setViewport(element, vp);
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
