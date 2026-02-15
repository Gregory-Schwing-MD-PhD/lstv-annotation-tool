/**
 * Dual-View DICOM Viewer - ARCHITECTURALLY FIXED
 * * CREDITS:
 * - Math & Projection Logic: Gemini (Corrected Vector Math & PixelSpacing)
 * - Rendering Architecture: Claude (Overlay Canvas & Event Loop Fixes)
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
        
        // Overlays
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
            // Initialize Cornerstone Tools
            if (typeof cornerstoneWADOImageLoader !== 'undefined') {
                cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
                cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
            }
            
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            // Create the Overlay Canvases (The Claude Fix)
            this.axialOverlay = this.createOverlayCanvas(this.axialElement);
            this.sagittalOverlay = this.createOverlayCanvas(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized with Overlay Architecture');
        } catch (error) {
            console.error('Error initializing dual viewer:', error);
        }
    }

    /**
     * Creates a transparent canvas strictly for drawing annotations
     * sitting exactly on top of the Cornerstone element.
     */
    createOverlayCanvas(element) {
        // Ensure parent is relative so absolute positioning works
        if (getComputedStyle(element).position === 'static') {
            element.style.position = 'relative';
        }

        const overlay = document.createElement('canvas');
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.pointerEvents = 'none'; // Let clicks pass through to Cornerstone
        overlay.style.zIndex = '10'; // Sit on top
        
        // Match dimensions
        overlay.width = element.clientWidth;
        overlay.height = element.clientHeight;
        
        element.appendChild(overlay);
        return overlay;
    }

    setupEventListeners() {
        // 1. Mouse Wheel (Scroll)
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

        // 2. Keyboard Navigation
        this.keyboardHandler = (e) => {
            if (this.axialImageIds.length === 0) return;
            
            if (e.key === 'ArrowUp') { this.previousAxialImage(); }
            else if (e.key === 'ArrowDown') { this.nextAxialImage(); }
            else if (e.key === 'ArrowLeft') { this.previousSagittalImage(); }
            else if (e.key === 'ArrowRight') { this.nextSagittalImage(); }
        };
        document.addEventListener('keydown', this.keyboardHandler);

        // 3. Window/Level (Brightness/Contrast)
        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);

        // 4. Synchronization (The Critical Fix)
        // We listen for when Cornerstone finishes rendering the image.
        // This handles initial load, scrolls, zooms, AND pans automatically.
        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            this.drawCrosshairOnAxial();
        });

        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            this.drawCrosshairOnSagittal();
        });
        
        // 5. Handle Resize
        window.addEventListener('resize', () => {
            this.resizeOverlays();
            cornerstone.resize(this.axialElement);
            cornerstone.resize(this.sagittalElement);
        });
    }

    resizeOverlays() {
        if (this.axialOverlay && this.axialElement) {
            this.axialOverlay.width = this.axialElement.clientWidth;
            this.axialOverlay.height = this.axialElement.clientHeight;
        }
        if (this.sagittalOverlay && this.sagittalElement) {
            this.sagittalOverlay.width = this.sagittalElement.clientWidth;
            this.sagittalOverlay.height = this.sagittalElement.clientHeight;
        }
    }

    setupWindowLevel(element) {
        let startX, startY, startWL, startWW;
        let isDragging = false;

        element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Left click only
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
     * Projects a 3D Point (mm) into 2D Image Pixel Coordinates (x, y)
     * * The Gemini Math Fix:
     * - Vector d = Point - Origin
     * - X_mm = Dot(d, RowVector)  -> Maps to Column Index
     * - Y_mm = Dot(d, ColVector)  -> Maps to Row Index
     * - PixelX = X_mm / ColumnSpacing
     * - PixelY = Y_mm / RowSpacing
     */
    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.orientation || !sliceMetadata.spacing) {
            return null;
        }
        
        const [px, py, pz] = worldPoint;
        const [sx, sy, sz] = sliceMetadata.position;
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing; // [Y-spacing, X-spacing]
        
        // Vector from Image Origin to Point
        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;
        
        // Project onto Row Vector (X-axis in patient space)
        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        
        // Project onto Column Vector (Y-axis in patient space)
        const mmY = dx * colX + dy * colY + dz * colZ;
        
        // Convert to Pixels
        return { 
            x: mmX / colSpacing, 
            y: mmY / rowSpacing 
        };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        this.clear();
        
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        // Start at middle
        const midAx = Math.floor(this.axialImageIds.length / 2);
        const midSag = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(midAx),
            this.displaySagittalImage(midSag)
        ]);
        
        this.updateSliceInfo();
    }

    async loadAxialSeries(files) {
        const results = await this.processFiles(files);
        // Sort by Z (Head to Feet)
        results.sort((a, b) => b.metadata.position[2] - a.metadata.position[2]);
        this.axialImageIds = results.map(r => ({ id: r.id }));
        this.axialMetadata = results.map(r => r.metadata);
    }

    async loadSagittalSeries(files) {
        const results = await this.processFiles(files);
        // Sort by X (Left to Right)
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
            } catch (e) {
                console.warn('Skipping file', file.filename);
                return null;
            }
        });
        return (await Promise.all(promises)).filter(x => x !== null);
    }

    async extractDicomMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            let meta = {
                position: image.imagePositionPatient,
                orientation: null,
                spacing: [image.rowPixelSpacing, image.columnPixelSpacing] // [Y, X]
            };

            // Handle Orientation
            if (image.rowCosines && image.columnCosines) {
                meta.orientation = [...image.rowCosines, ...image.columnCosines];
            }
            
            // WADO fallback if standard props missing
            if ((!meta.position || !meta.orientation) && image.data && image.data.string) {
                const ipp = image.data.string('x00200032');
                const iop = image.data.string('x00200037');
                if (ipp) meta.position = ipp.split('\\').map(parseFloat);
                if (iop) meta.orientation = iop.split('\\').map(parseFloat);
            }
            return meta;
        } catch (e) {
            console.error(e);
            return { position: [0,0,0], orientation: [1,0,0,0,1,0], spacing: [1,1] };
        }
    }

    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        this.currentAxialIndex = index;
        const imageId = this.axialImageIds[index].id;
        const image = await cornerstone.loadAndCacheImage(imageId);
        cornerstone.displayImage(this.axialElement, image);
        
        // We do NOT manually call drawCrosshair here.
        // cornerstone.displayImage triggers 'cornerstoneimagerendered'
        // which triggers our listener.
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
        
        // Project Sagittal Origin (which represents the slice plane X) onto Axial
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (proj) {
            // Use Gemini's Cornerstone Mapping (The "Brilliant" part)
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
        
        // Project Axial Origin (which represents the slice plane Z) onto Sagittal
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

    // Scroll Logic
    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
            // We must manually trigger sagittal redraw because 
            // the sagittal line depends on the axial index
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
        
        // Clear overlays
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

// Global instance
let dicomViewer = null;
