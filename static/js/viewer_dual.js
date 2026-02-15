/**
 * Dual-View DICOM Viewer - FINAL VERSION
 * Fixes: "resize is not a function" crash & White Screen Bug
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
        
        this.axialOverlay = null;
        this.sagittalOverlay = null;

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
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            // Create overlays (initially 0x0 if hidden)
            this.axialOverlay = this.createOverlayCanvas(this.axialElement);
            this.sagittalOverlay = this.createOverlayCanvas(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized');
        } catch (error) {
            console.error('Error initializing dual viewer:', error);
        }
    }

    /**
     * PUBLIC RESIZE METHOD - REQUIRED BY APP.JS
     * This fixes the 0x0 White Canvas bug
     */
    resize() {
        console.log('⚡ Manual Resize Triggered');
        
        // 1. Force Cornerstone to fit the new visible container
        cornerstone.resize(this.axialElement, true);
        cornerstone.resize(this.sagittalElement, true);

        // 2. Match Overlay Size to Element Size
        const sync = (overlay, element) => {
            if (overlay && element) {
                overlay.style.width = element.offsetWidth + 'px';
                overlay.style.height = element.offsetHeight + 'px';
                overlay.width = element.offsetWidth;
                overlay.height = element.offsetHeight;
                overlay.style.top = element.offsetTop + 'px';
                overlay.style.left = element.offsetLeft + 'px';
            }
        };
        sync(this.axialOverlay, this.axialElement);
        sync(this.sagittalOverlay, this.sagittalElement);

        // 3. Redraw Images (if loaded) to center them
        if (this.axialImageIds.length) {
            cornerstone.updateImage(this.axialElement);
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    createOverlayCanvas(element) {
        const parent = element.parentElement;
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        if (getComputedStyle(element).position === 'static') element.style.position = 'relative';

        const overlay = document.createElement('canvas');
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '10';
        
        element.parentElement.insertBefore(overlay, element.nextSibling);
        return overlay;
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

        document.addEventListener('keydown', (e) => {
            if (this.axialImageIds.length === 0) return;
            if (e.key === 'ArrowUp') this.previousAxialImage();
            if (e.key === 'ArrowDown') this.nextAxialImage();
            if (e.key === 'ArrowLeft') this.previousSagittalImage();
            if (e.key === 'ArrowRight') this.nextSagittalImage();
        });

        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);

        this.axialElement.addEventListener('cornerstoneimagerendered', () => this.drawCrosshairOnAxial());
        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => this.drawCrosshairOnSagittal());
        
        // Auto-resize on window change
        window.addEventListener('resize', () => this.resize());
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
        if (!sliceMetadata || !sliceMetadata.position) return null;
        
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
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);

        const midAx = Math.floor(this.axialImageIds.length / 2);
        const midSag = Math.floor(this.sagittalImageIds.length / 2);
        
        // Note: Display might render white first if hidden, fixed by resize() in app.js
        await Promise.all([
            this.displayAxialImage(midAx),
            this.displaySagittalImage(midSag)
        ]);
        
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
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        this.currentSagittalIndex = index;
        const image = await cornerstone.loadAndCacheImage(this.sagittalImageIds[index].id);
        cornerstone.displayImage(this.sagittalElement, image);
    }

    drawCrosshairOnAxial() {
        if (!this.axialOverlay || !this.sagittalMetadata.length) return;
        const ctx = this.axialOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.axialOverlay.width, this.axialOverlay.height);
        
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, { x: proj.x, y: proj.y });
            // Draw Vertical Line
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(canvasPoint.x, 0);
            ctx.lineTo(canvasPoint.x, this.axialOverlay.height);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawCrosshairOnSagittal() {
        if (!this.sagittalOverlay || !this.axialMetadata.length) return;
        const ctx = this.sagittalOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.sagittalOverlay.width, this.sagittalOverlay.height);
        
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        
        const proj = this.projectPointToSlice(axMeta.position, sagMeta);
        
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, { x: proj.x, y: proj.y });
            // Draw Horizontal Line
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(0, canvasPoint.y);
            ctx.lineTo(this.sagittalOverlay.width, canvasPoint.y);
            ctx.stroke();
            ctx.restore();
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
        
        if (this.axialOverlay) {
            const ctx = this.axialOverlay.getContext('2d');
            ctx.clearRect(0, 0, this.axialOverlay.width, this.axialOverlay.height);
        }
        if (this.sagittalOverlay) {
            const ctx = this.sagittalOverlay.getContext('2d');
            ctx.clearRect(0, 0, this.sagittalOverlay.width, this.sagittalOverlay.height);
        }
    }
}
let dicomViewer = null;
