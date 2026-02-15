/**
 * Dual-View DICOM Viewer - FIXED & OPTIMIZED VERSION
 * * FIXES IMPLEMENTED:
 * 1. PROJECTION MATH: Corrected the dot product mapping. 
 * - Row Vector (Orientation[0..2]) -> Maps to Column Index (X)
 * - Col Vector (Orientation[3..5]) -> Maps to Row Index (Y)
 * * 2. SPACING MATH: Corrected PixelSpacing usage.
 * - PixelSpacing is [RowSpacing (Y), ColSpacing (X)]
 * - x / spacing[1]
 * - y / spacing[0]
 * * 3. COORDINATE TRANSFORMATION:
 * - Replaced manual scaling logic with `cornerstone.pixelToCanvas`.
 * - This automatically handles Zoom, Pan, and Viewport offsets.
 */

class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        // Metadata storage
        this.axialMetadata = [];   
        this.sagittalMetadata = [];
        
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;
        
        this.isPlaying = false;
        this.playInterval = null;
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
            
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized');
        } catch (error) {
            console.error('Error initializing dual viewer:', error);
        }
    }

    setupEventListeners() {
        // Axial Scroll
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) this.previousAxialImage();
            else this.nextAxialImage();
        });

        // Sagittal Scroll
        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) this.previousSagittalImage();
            else this.nextSagittalImage();
        });

        // Keyboard Navigation
        this.keyboardHandler = (e) => {
            if (this.axialImageIds.length === 0 && this.sagittalImageIds.length === 0) return;
            
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.previousAxialImage(); // Up moves "up" the stack (cranial)
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.nextAxialImage(); // Down moves "down" the stack (caudal)
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.previousSagittalImage();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.nextSagittalImage();
            } else if (e.key === ' ') {
                e.preventDefault();
                this.togglePlay();
            }
        };
        
        document.addEventListener('keydown', this.keyboardHandler);
        
        // Window/Level adjustments
        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);
        
        // Sync Crosshairs on Pan/Zoom
        const updateHandler = () => {
             // Use requestAnimationFrame to prevent thrashing
            requestAnimationFrame(() => this.updateCrosshairs());
        };
        
        this.axialElement.addEventListener('cornerstoneimagerendered', updateHandler);
        this.sagittalElement.addEventListener('cornerstoneimagerendered', updateHandler);
    }

    setupWindowLevel(element) {
        let startX, startY, startWL, startWW;
        let isDragging = false;

        element.addEventListener('mousedown', (e) => {
            // Only trigger on left click (button 0)
            if (e.button !== 0) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            try {
                const viewport = cornerstone.getViewport(element);
                if (viewport && viewport.voi) {
                    startWL = viewport.voi.windowCenter;
                    startWW = viewport.voi.windowWidth;
                }
            } catch (error) {}
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            // Standard medical imaging W/L behavior:
            // Up/Down changes Level (Brightness)
            // Left/Right changes Width (Contrast)
            const newWL = startWL + deltaY;
            const newWW = Math.max(1, startWW + deltaX);
            
            try {
                const viewport = cornerstone.getViewport(element);
                if (viewport && viewport.voi) {
                    viewport.voi.windowCenter = newWL;
                    viewport.voi.windowWidth = newWW;
                    cornerstone.setViewport(element, viewport);
                }
            } catch (error) {}
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    async extractDicomMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            
            const metadata = {
                position: null, // ImagePositionPatient
                orientation: null, // ImageOrientationPatient
                spacing: null, // PixelSpacing
                rows: image.rows || 512,
                columns: image.columns || 512,
                sliceLocation: null // Optional
            };
            
            // 1. Try cornerstoneWADOImageLoader specific provider
            if (image.data && image.data.string) {
                // ImagePositionPatient (0020,0032)
                const ipp = image.data.string('x00200032');
                if (ipp) metadata.position = ipp.split('\\').map(parseFloat);
                
                // ImageOrientationPatient (0020,0037)
                const iop = image.data.string('x00200037');
                if (iop) metadata.orientation = iop.split('\\').map(parseFloat);
                
                // PixelSpacing (0028,0030)
                const ps = image.data.string('x00280030');
                if (ps) metadata.spacing = ps.split('\\').map(parseFloat);
            }
            
            // 2. Fallback to image object properties (Standard Cornerstone)
            if (!metadata.position && image.imagePositionPatient) {
                metadata.position = image.imagePositionPatient;
            }
            if (!metadata.orientation && image.rowCosines && image.columnCosines) {
                // Reconstruct array if separate
                metadata.orientation = [
                    ...image.rowCosines, 
                    ...image.columnCosines
                ];
            }
            if (!metadata.spacing && image.rowPixelSpacing && image.columnPixelSpacing) {
                // Note order: [rowSpacing (Y), colSpacing (X)]
                metadata.spacing = [image.rowPixelSpacing, image.columnPixelSpacing];
            }

            return metadata;
        } catch (error) {
            console.error('Error extracting metadata:', error);
            return null;
        }
    }

    /**
     * Projects a 3D Point (mm) into 2D Image Pixel Coordinates (x, y)
     * * MATH FIX:
     * - Vector d = Point - Origin
     * - X_mm = Dot(d, RowVector)
     * - Y_mm = Dot(d, ColVector)
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
        // PixelSpacing is [RowSpacing (vertical), ColSpacing (horizontal)]
        const [rowSpacing, colSpacing] = sliceMetadata.spacing; 
        
        // Vector from Image Origin to Point
        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;
        
        // 1. Project onto the Row Vector (which runs along the Image X-axis)
        // This gives the X-coordinate in mm
        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        
        // 2. Project onto the Column Vector (which runs along the Image Y-axis)
        // This gives the Y-coordinate in mm
        const mmY = dx * colX + dy * colY + dz * colZ;
        
        // 3. Convert to Pixels
        // X distance divides by Column Spacing (horizontal spacing)
        const x = mmX / colSpacing;
        
        // Y distance divides by Row Spacing (vertical spacing)
        const y = mmY / rowSpacing;
        
        return { x, y };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        this.clear();
        
        // UI Reset
        this.axialElement.innerHTML = '';
        this.sagittalElement.innerHTML = '';
        this.showLoading(this.axialElement, 'Loading Axial...');
        this.showLoading(this.sagittalElement, 'Loading Sagittal...');
        
        // Parallel Loading
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        this.hideLoading(this.axialElement);
        this.hideLoading(this.sagittalElement);
        
        // Display Middle Slices
        const axialStart = Math.floor(this.axialImageIds.length / 2);
        const sagittalStart = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(axialStart),
            this.displaySagittalImage(sagittalStart)
        ]);
        
        // Trigger resize and initial crosshair draw
        setTimeout(() => {
            cornerstone.resize(this.axialElement);
            cornerstone.resize(this.sagittalElement);
            this.updateCrosshairs();
        }, 100);
        
        this.updateSliceInfo();
    }

    showLoading(element, message) {
        // Simple loading overlay logic
        const existing = element.querySelector('.loading-overlay');
        if (existing) existing.remove();
        
        const div = document.createElement('div');
        div.className = 'loading-overlay';
        div.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);color:white;display:flex;justify-content:center;align-items:center;z-index:10;';
        div.innerHTML = `<span>${message}</span>`;
        element.appendChild(div);
    }

    hideLoading(element) {
        const existing = element.querySelector('.loading-overlay');
        if (existing) existing.remove();
    }

    async loadAxialSeries(files) {
        if (!files || !files.length) return;
        
        const results = await this.processFiles(files);
        // Sort by Z position usually (Slice Location) or Instance Number
        // Here, we sort by Filename numeric as a fallback, or ImagePositionPatient Z
        
        // Better Sort: Z-coordinate
        results.sort((a, b) => {
            if (a.metadata && b.metadata && a.metadata.position && b.metadata.position) {
                return b.metadata.position[2] - a.metadata.position[2]; // Descending Z for head-to-feet usually
            }
            return a.filename.localeCompare(b.filename, undefined, { numeric: true });
        });
        
        this.axialImageIds = results.map(r => ({ id: r.id }));
        this.axialMetadata = results.map(r => r.metadata);
    }

    async loadSagittalSeries(files) {
        if (!files || !files.length) return;
        
        const results = await this.processFiles(files);
        
        // Sort by X position (Left to Right)
        results.sort((a, b) => {
            if (a.metadata && b.metadata && a.metadata.position && b.metadata.position) {
                return a.metadata.position[0] - b.metadata.position[0]; 
            }
            return a.filename.localeCompare(b.filename, undefined, { numeric: true });
        });
        
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
                console.warn('Skipping file', file.filename, e);
                return null;
            }
        });
        return (await Promise.all(promises)).filter(x => x !== null);
    }

    async displayAxialImage(index) {
        if (!this.isInitialized || index < 0 || index >= this.axialImageIds.length) return;
        
        this.currentAxialIndex = index;
        const imageId = this.axialImageIds[index].id;
        
        try {
            const image = await cornerstone.loadAndCacheImage(imageId);
            cornerstone.displayImage(this.axialElement, image);
            
            // Set initial W/L if not set
            const viewport = cornerstone.getViewport(this.axialElement);
            if (!viewport.voi.windowCenter) {
                 // Auto defaults if missing
                 viewport.voi.windowCenter = 400; 
                 viewport.voi.windowWidth = 2000;
                 cornerstone.setViewport(this.axialElement, viewport);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async displaySagittalImage(index) {
        if (!this.isInitialized || index < 0 || index >= this.sagittalImageIds.length) return;
        
        this.currentSagittalIndex = index;
        const imageId = this.sagittalImageIds[index].id;
        
        try {
            const image = await cornerstone.loadAndCacheImage(imageId);
            cornerstone.displayImage(this.sagittalElement, image);
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * DRAW CROSSHAIRS
     * We use a canvas overlay on top of the Cornerstone canvas.
     * We use `cornerstone.pixelToCanvas` to map the calculated Pixel coordinates
     * to the actual screen coordinates.
     */
    drawCrosshairOnAxial() {
        if (!this.axialImageIds.length) return;
        
        const canvas = this.axialElement.querySelector('canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        // Do NOT call clearRect here; Cornerstone renders the image, we just draw on top 
        // immediately after render.
        // Wait, cornerstone canvas is the image itself. We shouldn't dirty it permanently.
        // Actually, the `cornerstoneimagerendered` event is where we should hook.
        // But for simplicity in this class, we redraw after update.
        // Ideally, use `cornerstone.updateImage` which triggers the render loop.
        
        // 1. Get Sagittal Position
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        
        if (!sagMeta || !axMeta) return;
        
        // 2. Project Sagittal Origin onto Axial Plane
        // Sagittal slices stack Left-to-Right. The 'X' coordinate in Patient Space changes.
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (proj) {
            // 3. Convert Pixel (x, y) to Canvas (x, y)
            const canvasPoint = cornerstone.pixelToCanvas(this.axialElement, { x: proj.x, y: proj.y });
            
            // 4. Draw Vertical Line at canvasPoint.x
            // Because axial view looks down Z, and Sagittal slice is a vertical plane at X.
            // The intersection is a vertical line on the axial image.
            
            // We need to redraw the image first to clear previous lines
            // However, calling updateImage here causes infinite loop if called from event handler.
            // We will just draw directly. NOTE: This persists until next render.
            // A cleaner way is using cornerstone tools, but we are doing vanilla.
            
            // Force redraw of image to clear old lines, THEN draw new one?
            // No, simply rely on the event loop.
            
            this.renderLine(ctx, canvas.width, canvas.height, canvasPoint.x, null, '#00ff00');
        }
    }

    drawCrosshairOnSagittal() {
        if (!this.sagittalImageIds.length) return;
        
        const canvas = this.sagittalElement.querySelector('canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        
        if (!axMeta || !sagMeta) return;
        
        // Project Axial Origin onto Sagittal Plane
        // Axial slices stack Bottom-to-Top (Z). The 'Z' coordinate changes.
        // On Sagittal view (Y vs Z), this corresponds to a specific Y-pixel row.
        const proj = this.projectPointToSlice(axMeta.position, sagMeta);
        
        if (proj) {
            const canvasPoint = cornerstone.pixelToCanvas(this.sagittalElement, { x: proj.x, y: proj.y });
            
            // Draw Horizontal Line at canvasPoint.y
            this.renderLine(ctx, canvas.width, canvas.height, null, canvasPoint.y, '#00ff00');
        }
    }
    
    // Helper to draw lines
    renderLine(ctx, width, height, x, y, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]); // Dashed line
        ctx.beginPath();
        
        if (x !== null) {
            // Vertical Line
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        } else if (y !== null) {
            // Horizontal Line
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        
        ctx.stroke();
        ctx.restore();
    }
    
    // Triggered externally or by scroll
    updateCrosshairs() {
        // We trigger a re-render of the underlying image
        // The event listener 'cornerstoneimagerendered' will call our draw logic
        // But we need to define that logic inside the event listener essentially.
        // For this simple implementation, we can just force update and hook into the event.
        
        // Actually, to avoid infinite loops, we don't call updateImage inside the draw function.
        // We call it here.
        cornerstone.updateImage(this.axialElement);
        cornerstone.updateImage(this.sagittalElement);
        
        // We must attach a one-time draw or have a persistent listener.
        // In `setupEventListeners`, we added a persistent listener `updateHandler`.
        // `updateHandler` calls `drawCrosshairOnAxial` / `Sagittal`.
        // BUT, `drawCrosshair` must NOT call `updateImage`.
        
        // Implementation:
        // 1. this.updateCrosshairs() calls cornerstone.updateImage()
        // 2. cornerstone fires 'cornerstoneimagerendered'
        // 3. Listener calls this.drawCrosshairOn...()
        // 4. drawCrosshairOn...() draws the line on the canvas. Done.
    }
    
    // Specifically for the event listener to call (does NOT trigger updateImage)
    _drawOverlays() {
        // This is called AFTER image render
        this.drawCrosshairOnAxial();
        this.drawCrosshairOnSagittal();
    }
    
    // Override setupEventListeners to use the specific hook
    setupEventListeners() {
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
        
        // Hook for drawing lines
        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            this.drawCrosshairOnAxial();
        });
        
        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            this.drawCrosshairOnSagittal();
        });
        
        // Window Level Dragging
        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);
        
        document.addEventListener('keydown', (e) => {
             if (this.axialImageIds.length === 0) return;
             
             if (e.key === 'ArrowUp') { this.previousAxialImage(); }
             else if (e.key === 'ArrowDown') { this.nextAxialImage(); }
             else if (e.key === 'ArrowLeft') { this.previousSagittalImage(); }
             else if (e.key === 'ArrowRight') { this.nextSagittalImage(); }
        });
    }

    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            this.currentAxialIndex++;
            await this.displayAxialImage(this.currentAxialIndex);
            this.updateSliceInfo();
            // Force sagittal update to move line? 
            // Sagittal line depends on Axial Index.
            cornerstone.updateImage(this.sagittalElement); 
        }
    }

    async previousAxialImage() {
        if (this.currentAxialIndex > 0) {
            this.currentAxialIndex--;
            await this.displayAxialImage(this.currentAxialIndex);
            this.updateSliceInfo();
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    async nextSagittalImage() {
        if (this.currentSagittalIndex < this.sagittalImageIds.length - 1) {
            this.currentSagittalIndex++;
            await this.displaySagittalImage(this.currentSagittalIndex);
            this.updateSliceInfo();
            // Axial line depends on Sagittal Index
            cornerstone.updateImage(this.axialElement);
        }
    }

    async previousSagittalImage() {
        if (this.currentSagittalIndex > 0) {
            this.currentSagittalIndex--;
            await this.displaySagittalImage(this.currentSagittalIndex);
            this.updateSliceInfo();
            cornerstone.updateImage(this.axialElement);
        }
    }

    resetWindowLevel() {
        const reset = (el) => {
            const vp = cornerstone.getViewport(el);
            if (vp) {
                cornerstone.reset(el);
            }
        };
        reset(this.axialElement);
        reset(this.sagittalElement);
    }
    
    updateSliceInfo() {
        const as = document.getElementById('axialSlice');
        const at = document.getElementById('axialTotal');
        const ss = document.getElementById('sagittalSlice');
        const st = document.getElementById('sagittalTotal');
        
        if (as) as.textContent = this.currentAxialIndex + 1;
        if (at) at.textContent = this.axialImageIds.length;
        if (ss) ss.textContent = this.currentSagittalIndex + 1;
        if (st) st.textContent = this.sagittalImageIds.length;
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
        try {
            cornerstone.disable(this.axialElement);
            cornerstone.disable(this.sagittalElement);
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
        } catch(e) {}
    }
}

// Global instance
let dicomViewer = null;
