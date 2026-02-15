/**
 * Dual-View DICOM Viewer - FINAL FIXED VERSION
 * Combined Architecture:
 * 1. Overlay Timing: Fixed (Claude's Approach)
 * 2. Progress Feedback: Fixed (Claude's Approach)
 * 3. Projection Math: Fixed (Permissive Orthogonal Logic)
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
        
        // Overlays (initially null, created after load)
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
            // Initialize Cornerstone FIRST
            if (typeof cornerstoneWADOImageLoader !== 'undefined') {
                cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
                cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
            }
            
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized (Overlays pending load)');
        } catch (error) {
            console.error('Error initializing dual viewer:', error);
        }
    }

    /**
     * Create overlay AFTER images are loaded and elements have dimensions
     */
    createOverlayCanvas(element) {
        // Safety check: Element must have size
        if (element.offsetWidth === 0 || element.offsetHeight === 0) {
            console.warn('Element has no dimensions yet, cannot create overlay.');
            return null;
        }

        const parent = element.parentElement;
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }
        if (getComputedStyle(element).position === 'static') {
            element.style.position = 'relative';
        }

        const overlay = document.createElement('canvas');
        overlay.className = 'crosshair-overlay';
        overlay.style.position = 'absolute';
        
        // Exact alignment
        overlay.style.top = element.offsetTop + 'px';
        overlay.style.left = element.offsetLeft + 'px';
        overlay.style.width = element.offsetWidth + 'px';
        overlay.style.height = element.offsetHeight + 'px';
        
        // Internal resolution
        overlay.width = element.offsetWidth;
        overlay.height = element.offsetHeight;
        
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '10';
        
        // Insert as sibling
        element.parentElement.insertBefore(overlay, element.nextSibling);
        
        console.log(`✓ Created overlay: ${overlay.width}x${overlay.height}`);
        return overlay;
    }

    setupEventListeners() {
        // Scroll
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) this.previousAxialImage();
            else this.nextAxialImage();
        });

        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) this.previousSagittalImage();
            else this.nextSagittalImage();
        });

        // Keyboard
        this.keyboardHandler = (e) => {
            if (this.axialImageIds.length === 0) return;
            if (e.key === 'ArrowUp') { this.previousAxialImage(); }
            else if (e.key === 'ArrowDown') { this.nextAxialImage(); }
            else if (e.key === 'ArrowLeft') { this.previousSagittalImage(); }
            else if (e.key === 'ArrowRight') { this.nextSagittalImage(); }
        };
        document.addEventListener('keydown', this.keyboardHandler);

        // Window/Level
        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);

        // Render Loop - Sync Crosshairs
        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            this.drawCrosshairOnAxial();
        });
        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            this.drawCrosshairOnSagittal();
        });
        
        // Resize
        window.addEventListener('resize', () => {
            this.resizeOverlays();
            cornerstone.resize(this.axialElement);
            cornerstone.resize(this.sagittalElement);
        });
    }

    resizeOverlays() {
        const resize = (overlay, element) => {
            if (overlay && element) {
                overlay.style.width = element.offsetWidth + 'px';
                overlay.style.height = element.offsetHeight + 'px';
                overlay.width = element.offsetWidth;
                overlay.height = element.offsetHeight;
                overlay.style.top = element.offsetTop + 'px';
                overlay.style.left = element.offsetLeft + 'px';
            }
        };
        resize(this.axialOverlay, this.axialElement);
        resize(this.sagittalOverlay, this.sagittalElement);
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
                const viewport = cornerstone.getViewport(element);
                startWL = viewport.voi.windowCenter;
                startWW = viewport.voi.windowWidth;
            } catch (e) {}
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            try {
                const viewport = cornerstone.getViewport(element);
                viewport.voi.windowCenter = startWL + deltaY;
                viewport.voi.windowWidth = Math.max(1, startWW + deltaX);
                cornerstone.setViewport(element, viewport);
            } catch (e) {}
        });

        document.addEventListener('mouseup', () => isDragging = false);
    }

    /**
     * ORTHOGONAL PROJECTION MATH
     * Note: We DO NOT check distanceToPlane here. 
     * Even if the Reference Origin is far away (large Z delta), 
     * the orthogonal planes still intersect.
     */
    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.orientation || !sliceMetadata.spacing) {
            return null;
        }
        
        const [px, py, pz] = worldPoint;
        const [sx, sy, sz] = sliceMetadata.position;
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;
        
        // Vector from Image Origin to Point
        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;
        
        // 1. Project onto the Row Vector (Image X-axis)
        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        
        // 2. Project onto the Column Vector (Image Y-axis)
        const mmY = dx * colX + dy * colY + dz * colZ;
        
        // 3. Convert to Pixels
        const pixelX = mmX / colSpacing;
        const pixelY = mmY / rowSpacing;
        
        // Return raw coordinates. Let the drawer decide validity.
        return { x: pixelX, y: pixelY };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        console.log(`📥 Loading dual series: ${axialFiles.length} axial, ${sagittalFiles.length} sagittal`);
        
        this.clear();
        
        this.showProgress('Processing axial images...', 0, axialFiles.length);
        await this.loadAxialSeries(axialFiles);
        
        this.showProgress('Processing sagittal images...', 0, sagittalFiles.length);
        await this.loadSagittalSeries(sagittalFiles);
        
        this.hideProgress();
        
        const midAx = Math.floor(this.axialImageIds.length / 2);
        const midSag = Math.floor(this.sagittalImageIds.length / 2);
        
        // 1. Display Images (This gives the container dimensions)
        await Promise.all([
            this.displayAxialImage(midAx),
            this.displaySagittalImage(midSag)
        ]);
        
        // 2. NOW create overlays (Delayed init to fix 0x0 bug)
        // We use a short timeout to ensure the DOM has reflowed
        setTimeout(() => {
            // Remove old if exist
            if (this.axialOverlay) this.axialOverlay.remove();
            if (this.sagittalOverlay) this.sagittalOverlay.remove();

            this.axialOverlay = this.createOverlayCanvas(this.axialElement);
            this.sagittalOverlay = this.createOverlayCanvas(this.sagittalElement);
            
            // Force Redraw
            cornerstone.updateImage(this.axialElement);
            cornerstone.updateImage(this.sagittalElement);
        }, 100);
        
        this.updateSliceInfo();
    }

    showProgress(message, current, total) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const progressEl = document.getElementById('loadingMessage');
        if (progressEl) {
            // Assuming your loading message has a span or just text
            const span = progressEl.querySelector('span');
            if (span) span.innerText = `${message} ${current}/${total} (${percent}%)`;
            else progressEl.innerText = `${message} ${current}/${total} (${percent}%)`;
            
            progressEl.style.display = 'flex';
        }
    }

    hideProgress() {
        const progressEl = document.getElementById('loadingMessage');
        if (progressEl) {
            progressEl.style.display = 'none';
        }
    }

    async loadAxialSeries(files) {
        const results = [];
        for (let i = 0; i < files.length; i++) {
            this.showProgress('Processing axial...', i + 1, files.length);
            const result = await this.processFile(files[i]);
            if (result) results.push(result);
        }
        results.sort((a, b) => b.metadata.position[2] - a.metadata.position[2]);
        this.axialImageIds = results.map(r => ({ id: r.id }));
        this.axialMetadata = results.map(r => r.metadata);
    }

    async loadSagittalSeries(files) {
        const results = [];
        for (let i = 0; i < files.length; i++) {
            this.showProgress('Processing sagittal...', i + 1, files.length);
            const result = await this.processFile(files[i]);
            if (result) results.push(result);
        }
        results.sort((a, b) => a.metadata.position[0] - b.metadata.position[0]);
        this.sagittalImageIds = results.map(r => ({ id: r.id }));
        this.sagittalMetadata = results.map(r => r.metadata);
    }

    async processFile(file) {
        try {
            const blob = new Blob([file.data], { type: 'application/dicom' });
            const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
            const metadata = await this.extractDicomMetadata(imageId);
            return { id: imageId, filename: file.filename, metadata };
        } catch (e) {
            return null;
        }
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
        const imageId = this.axialImageIds[index].id;
        const image = await cornerstone.loadAndCacheImage(imageId);
        cornerstone.displayImage(this.axialElement, image);
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        this.currentSagittalIndex = index;
        const imageId = this.sagittalImageIds[index].id;
        const image = await cornerstone.loadAndCacheImage(imageId);
        cornerstone.displayImage(this.sagittalElement, image);
    }

    drawCrosshairOnAxial() {
        if (!this.axialOverlay || !this.sagittalMetadata.length) return;
        
        const ctx = this.axialOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.axialOverlay.width, this.axialOverlay.height);
        
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        
        // Project Sagittal Origin onto Axial plane
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (proj) {
            // Orthogonal Logic: For Axial, we ONLY care about X. 
            // Y is usually wildly out of bounds because Sagittal Origin is at top of head.
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, { x: proj.x, y: proj.y });
            
            // Only draw if X is visible. Ignore Y.
            if (canvasPoint.x >= 0 && canvasPoint.x <= this.axialOverlay.width) {
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
    }

    drawCrosshairOnSagittal() {
        if (!this.sagittalOverlay || !this.axialMetadata.length) return;
        
        const ctx = this.sagittalOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.sagittalOverlay.width, this.sagittalOverlay.height);
        
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        
        // Project Axial Origin onto Sagittal plane
        const proj = this.projectPointToSlice(axMeta.position, sagMeta);
        
        if (proj) {
            // Orthogonal Logic: For Sagittal, we ONLY care about Y.
            // X is usually out of bounds because Axial Origin is right/left side.
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, { x: proj.x, y: proj.y });
            
            // Only draw if Y is visible. Ignore X.
            if (canvasPoint.y >= 0 && canvasPoint.y <= this.sagittalOverlay.height) {
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
