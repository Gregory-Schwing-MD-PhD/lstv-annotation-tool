/**
 * Dual-View DICOM Viewer - PRODUCTION READY
 * Fixed overlay canvas architecture that doesn't break Cornerstone
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
            // Initialize Cornerstone FIRST
            if (typeof cornerstoneWADOImageLoader !== 'undefined') {
                cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
                cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
            }
            
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            console.log('✓ Cornerstone enabled');
            
            // THEN create overlays (after Cornerstone has initialized its canvas)
            this.axialOverlay = this.createOverlayCanvas(this.axialElement);
            this.sagittalOverlay = this.createOverlayCanvas(this.sagittalElement);
            
            console.log('✓ Overlay canvases created');
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized');
        } catch (error) {
            console.error('Error initializing dual viewer:', error);
        }
    }

    /**
     * CRITICAL FIX: Create overlay as a SIBLING, not a child
     * Cornerstone controls the child canvas - we can't touch it
     */
    createOverlayCanvas(element) {
        // Ensure the Cornerstone element's parent container can hold positioned children
        const parent = element.parentElement;
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        // Make the Cornerstone element itself relatively positioned
        if (getComputedStyle(element).position === 'static') {
            element.style.position = 'relative';
        }

        const overlay = document.createElement('canvas');
        overlay.className = 'crosshair-overlay'; // For debugging
        overlay.style.position = 'absolute';
        
        // Position exactly over the Cornerstone element
        const rect = element.getBoundingClientRect();
        overlay.style.top = element.offsetTop + 'px';
        overlay.style.left = element.offsetLeft + 'px';
        overlay.style.width = element.offsetWidth + 'px';
        overlay.style.height = element.offsetHeight + 'px';
        
        // Set canvas internal resolution to match display size
        overlay.width = element.offsetWidth;
        overlay.height = element.offsetHeight;
        
        overlay.style.pointerEvents = 'none'; // Let clicks pass through
        overlay.style.zIndex = '10'; // Sit on top
        
        // Insert AFTER the Cornerstone element as a sibling
        element.parentElement.insertBefore(overlay, element.nextSibling);
        
        console.log(`Created overlay: ${overlay.width}x${overlay.height} at (${overlay.style.left}, ${overlay.style.top})`);
        
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

        // 4. Synchronization - Draw crosshairs after each render
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
        
        console.log('✓ Event listeners setup');
    }

    resizeOverlays() {
        if (this.axialOverlay && this.axialElement) {
            const rect = this.axialElement.getBoundingClientRect();
            this.axialOverlay.style.width = this.axialElement.offsetWidth + 'px';
            this.axialOverlay.style.height = this.axialElement.offsetHeight + 'px';
            this.axialOverlay.width = this.axialElement.offsetWidth;
            this.axialOverlay.height = this.axialElement.offsetHeight;
        }
        if (this.sagittalOverlay && this.sagittalElement) {
            const rect = this.sagittalElement.getBoundingClientRect();
            this.sagittalOverlay.style.width = this.sagittalElement.offsetWidth + 'px';
            this.sagittalOverlay.style.height = this.sagittalElement.offsetHeight + 'px';
            this.sagittalOverlay.width = this.sagittalElement.offsetWidth;
            this.sagittalOverlay.height = this.sagittalElement.offsetHeight;
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
     * DIAGNOSTIC VERSION - Projects 3D point to 2D pixel coordinates
     * Logs all intermediate steps to debug the math
     */
    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.orientation || !sliceMetadata.spacing) {
            console.warn('Missing metadata for projection');
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
        
        // Project onto Row Vector (should give X coordinate in mm)
        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        
        // Project onto Column Vector (should give Y coordinate in mm)
        const mmY = dx * colX + dy * colY + dz * colZ;
        
        // Convert mm to pixels
        const pixelX = mmX / colSpacing;
        const pixelY = mmY / rowSpacing;
        
        // DIAGNOSTIC LOGGING
        console.log(`
🔍 PROJECTION DEBUG:
   World Point: [${px.toFixed(1)}, ${py.toFixed(1)}, ${pz.toFixed(1)}]
   Slice Origin: [${sx.toFixed(1)}, ${sy.toFixed(1)}, ${sz.toFixed(1)}]
   Delta Vector: [${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)}]
   Row Vector: [${rowX.toFixed(3)}, ${rowY.toFixed(3)}, ${rowZ.toFixed(3)}]
   Col Vector: [${colX.toFixed(3)}, ${colY.toFixed(3)}, ${colZ.toFixed(3)}]
   MM Projection: [${mmX.toFixed(1)}, ${mmY.toFixed(1)}]
   Spacing: [row=${rowSpacing.toFixed(2)}, col=${colSpacing.toFixed(2)}]
   FINAL PIXELS: [${pixelX.toFixed(1)}, ${pixelY.toFixed(1)}]
        `);
        
        return { x: pixelX, y: pixelY };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        console.log(`Loading dual series: ${axialFiles.length} axial, ${sagittalFiles.length} sagittal`);
        
        this.clear();
        
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        console.log(`✓ Loaded ${this.axialImageIds.length} axial, ${this.sagittalImageIds.length} sagittal images`);
        
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
        // Sort by Z (Head to Feet) - descending
        results.sort((a, b) => b.metadata.position[2] - a.metadata.position[2]);
        this.axialImageIds = results.map(r => ({ id: r.id }));
        this.axialMetadata = results.map(r => r.metadata);
        
        console.log(`Axial Z range: ${results[0].metadata.position[2].toFixed(1)} to ${results[results.length-1].metadata.position[2].toFixed(1)} mm`);
    }

    async loadSagittalSeries(files) {
        const results = await this.processFiles(files);
        // Sort by X (Left to Right) - ascending
        results.sort((a, b) => a.metadata.position[0] - b.metadata.position[0]);
        this.sagittalImageIds = results.map(r => ({ id: r.id }));
        this.sagittalMetadata = results.map(r => r.metadata);
        
        console.log(`Sagittal X range: ${results[0].metadata.position[0].toFixed(1)} to ${results[results.length-1].metadata.position[0].toFixed(1)} mm`);
    }

    async processFiles(files) {
        const promises = files.map(async (file) => {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                const metadata = await this.extractDicomMetadata(imageId);
                return { id: imageId, filename: file.filename, metadata };
            } catch (e) {
                console.warn('Skipping file', file.filename, e);
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
                spacing: [image.rowPixelSpacing, image.columnPixelSpacing], // [Y, X]
                rows: image.rows,
                columns: image.columns
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
            console.error('Error extracting metadata:', e);
            return { position: [0,0,0], orientation: [1,0,0,0,1,0], spacing: [1,1], rows: 512, columns: 512 };
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
        
        console.log(`Drawing axial crosshair: sag slice ${this.currentSagittalIndex + 1}/${this.sagittalMetadata.length}`);
        
        // Project Sagittal Origin onto Axial plane
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, { x: proj.x, y: proj.y });
            
            console.log(`Canvas point: x=${canvasPoint.x.toFixed(1)}, y=${canvasPoint.y.toFixed(1)}`);
            
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
        
        console.log(`Drawing sagittal crosshair: ax slice ${this.currentAxialIndex + 1}/${this.axialMetadata.length}`);
        
        // Project Axial Origin onto Sagittal plane
        const proj = this.projectPointToSlice(axMeta.position, sagMeta);
        
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, { x: proj.x, y: proj.y });
            
            console.log(`Canvas point: x=${canvasPoint.x.toFixed(1)}, y=${canvasPoint.y.toFixed(1)}`);
            
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
            // Trigger sagittal redraw (the line position depends on axial index)
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
            // Trigger axial redraw (the line position depends on sagittal index)
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
