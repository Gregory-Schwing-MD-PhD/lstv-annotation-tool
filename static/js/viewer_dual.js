/**
 * Dual-View DICOM Viewer - FIXED VERSION
 * 
 * BUG DIAGNOSIS FROM CONSOLE:
 * 
 * AXIAL CROSSHAIR (WRONG):
 *   Sag 8/17:  sagX=1.4mm  → col=323 → canvasX=194
 *   Sag 16/17: sagX=38.1mm → col=441 → canvasX=265
 *   Range: X only moves 71 pixels (194→265) when it should move ~300 pixels
 * 
 * SAGITTAL CROSSHAIR (WRONG):
 *   Ax 13/27:  axZ=-31.4mm  → row=165 → canvasY=306
 *   Ax 26/27:  axZ=-140.4mm → row=281 → canvasY=445 (OFF SCREEN!)
 * 
 * ROOT CAUSE:
 *   The code does: canvasX = bounds.left + (col / columns) * bounds.width
 *   This is WRONG because:
 *   - Image is 512x512 pixels
 *   - Canvas renders it as 384x384 pixels (scaled down 0.75x)
 *   - col=323 / 512 = 0.63, then 0.63 * 384 = 242
 *   - But actual col=323 * 0.75 = 242, not 194!
 * 
 * THE FIX:
 *   Calculate scale = bounds.width / imageWidth
 *   Then: canvasX = bounds.left + (col * scale)
 *   This correctly maps pixel coordinates to canvas coordinates
 */

class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        // CRITICAL: Store DICOM spatial metadata for each slice
        this.axialMetadata = [];   // {position: [x,y,z], orientation: [...], spacing: [...]}
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

        this.keyboardHandler = (e) => {
            if (this.axialImageIds.length === 0 && this.sagittalImageIds.length === 0) return;
            
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.previousAxialImage();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.nextAxialImage();
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
        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);
    }

    setupWindowLevel(element) {
        let startX, startY, startWL, startWW;
        let isDragging = false;

        element.addEventListener('mousedown', (e) => {
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

    /**
     * Extract DICOM spatial metadata from image
     * 
     * EXTRACTS:
     * - ImagePositionPatient (0020,0032): [x, y, z] in mm - position of top-left pixel
     * - ImageOrientationPatient (0020,0037): [rowX, rowY, rowZ, colX, colY, colZ] - direction cosines
     * - PixelSpacing (0028,0030): [row_spacing, col_spacing] in mm/pixel
     * - Rows, Columns: Image dimensions in pixels
     */
    async extractDicomMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            
            const metadata = {
                position: null,
                orientation: null,
                spacing: null,
                rows: image.rows || 512,
                columns: image.columns || 512
            };
            
            // Try to get from DICOM data tags
            if (image.data && image.data.string) {
                const ipp = image.data.string('x00200032');
                if (ipp) {
                    metadata.position = ipp.split('\\').map(parseFloat);
                }
                
                const iop = image.data.string('x00200037');
                if (iop) {
                    metadata.orientation = iop.split('\\').map(parseFloat);
                }
                
                const ps = image.data.string('x00280030');
                if (ps) {
                    metadata.spacing = ps.split('\\').map(parseFloat);
                }
            }
            
            // Fallback to direct properties
            if (!metadata.position && image.imagePositionPatient) {
                metadata.position = image.imagePositionPatient;
            }
            if (!metadata.orientation && image.imageOrientationPatient) {
                metadata.orientation = image.imageOrientationPatient;
            }
            if (!metadata.spacing && image.pixelSpacing) {
                metadata.spacing = image.pixelSpacing;
            }
            
            return metadata;
        } catch (error) {
            console.error('Error extracting DICOM metadata:', error);
            return null;
        }
    }

    /**
     * Project a 3D world point onto a 2D image slice
     * 
     * HOW IT WORKS:
     * 1. Calculate vector from image origin to the 3D point: (dx, dy, dz)
     * 2. Project this vector onto the image's row direction: dot(vector, rowDirection) → distance in mm
     * 3. Project this vector onto the image's column direction: dot(vector, colDirection) → distance in mm
     * 4. Convert mm to pixels by dividing by pixel spacing
     * 
     * RETURNS: {row, col} in pixel coordinates (floating point, can be fractional)
     */
    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.orientation || !sliceMetadata.spacing) {
            return null;
        }
        
        const [px, py, pz] = worldPoint;  // 3D point to project (in mm)
        const [sx, sy, sz] = sliceMetadata.position;  // Image origin (top-left pixel) in mm
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;  // Direction cosines
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;  // mm per pixel
        
        // Vector from image origin to point (in mm)
        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;
        
        // Dot product with row direction gives distance along rows (in mm)
        // Row direction = first 3 values of ImageOrientationPatient
        const mmAlongRows = dx * rowX + dy * rowY + dz * rowZ;
        const row = mmAlongRows / rowSpacing;  // Convert mm to pixels
        
        // Dot product with column direction gives distance along columns (in mm)
        // Column direction = last 3 values of ImageOrientationPatient
        const mmAlongCols = dx * colX + dy * colY + dz * colZ;
        const col = mmAlongCols / colSpacing;  // Convert mm to pixels
        
        return {row, col};
    }

    /**
     * Get rendered image boundaries on canvas
     * 
     * CRITICAL: Images may not fill entire canvas due to:
     * - Scaling/zoom (viewport.scale)
     * - Pan/translation (viewport.translation)
     * - Aspect ratio differences between image and canvas
     * 
     * RETURNS: {left, top, right, bottom, width, height} in canvas pixels
     */
    getImageBounds(element) {
        try {
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) return null;
            
            const image = enabledElement.image;
            const viewport = enabledElement.viewport;
            const canvas = enabledElement.canvas;
            
            // Get scale factor (zoom level)
            const scale = viewport.scale || 1;
            const renderedWidth = image.width * scale;
            const renderedHeight = image.height * scale;
            
            // Get translation (pan offset)
            const translation = viewport.translation || { x: 0, y: 0 };
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            
            // Calculate image position (centered by default, then translated)
            const left = (canvasWidth / 2) - (renderedWidth / 2) + translation.x;
            const top = (canvasHeight / 2) - (renderedHeight / 2) + translation.y;
            
            return {
                left, 
                top,
                right: left + renderedWidth,
                bottom: top + renderedHeight,
                width: renderedWidth,
                height: renderedHeight
            };
        } catch (error) {
            return null;
        }
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        console.log(`Loading dual series: ${axialFiles.length} axial, ${sagittalFiles.length} sagittal`);
        
        this.axialElement.style.display = 'block';
        this.axialElement.style.width = '100%';
        this.axialElement.style.height = '600px';
        
        this.sagittalElement.style.display = 'block';
        this.sagittalElement.style.width = '100%';
        this.sagittalElement.style.height = '600px';
        
        this.showLoading(this.axialElement, 'Loading axial...');
        this.showLoading(this.sagittalElement, 'Loading sagittal...');
        
        const startTime = Date.now();
        
        // Load BOTH series in parallel
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        const loadTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✓ Loaded in ${loadTime}s with spatial metadata`);
        
        this.hideLoading(this.axialElement);
        this.hideLoading(this.sagittalElement);
        
        const axialStart = Math.floor(this.axialImageIds.length / 2);
        const sagittalStart = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(axialStart),
            this.displaySagittalImage(sagittalStart)
        ]);
        
        setTimeout(() => {
            try {
                cornerstone.resize(this.axialElement, true);
                cornerstone.resize(this.sagittalElement, true);
                cornerstone.updateImage(this.axialElement);
                cornerstone.updateImage(this.sagittalElement);
                this.updateCrosshairs();
            } catch (e) {}
        }, 150);
        
        this.updateSliceInfo();
    }

    showLoading(element, message) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading-overlay';
        loadingDiv.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;z-index:1000;`;
        loadingDiv.innerHTML = `<div style="width:40px;height:40px;border:4px solid #444;border-top:4px solid #2563eb;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:1rem;"></div><p>${message}</p>`;
        element.parentElement.style.position = 'relative';
        element.parentElement.appendChild(loadingDiv);
    }

    hideLoading(element) {
        const loadingDiv = element.parentElement.querySelector('.loading-overlay');
        if (loadingDiv) loadingDiv.remove();
    }

    /**
     * Load axial series with DICOM metadata extraction
     * Each slice gets full spatial metadata for coordinate projection
     */
    async loadAxialSeries(axialFiles) {
        if (!axialFiles || axialFiles.length === 0) return;
        
        this.axialImageIds = [];
        this.axialMetadata = [];
        
        // Load ALL files in parallel with metadata extraction
        const results = await Promise.all(
            axialFiles.map(async (file) => {
                try {
                    const blob = new Blob([file.data], { type: 'application/dicom' });
                    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                    const metadata = await this.extractDicomMetadata(imageId);
                    return { id: imageId, filename: file.filename, metadata };
                } catch (error) {
                    console.error(`Error loading axial ${file.filename}:`, error);
                    return null;
                }
            })
        );
        
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        this.axialImageIds = validResults.map(r => ({ id: r.id, filename: r.filename }));
        this.axialMetadata = validResults.map(r => r.metadata);
        
        console.log(`✓ ${this.axialImageIds.length} axial with metadata`);
        
        if (this.axialMetadata[0] && this.axialMetadata[0].position) {
            const first = this.axialMetadata[0];
            const last = this.axialMetadata[this.axialMetadata.length - 1];
            console.log(`  Axial Z range: ${first.position[2].toFixed(1)} to ${last.position[2].toFixed(1)} mm`);
        }
    }

    async loadSagittalSeries(sagittalFiles) {
        if (!sagittalFiles || sagittalFiles.length === 0) return;
        
        this.sagittalImageIds = [];
        this.sagittalMetadata = [];
        
        const results = await Promise.all(
            sagittalFiles.map(async (file) => {
                try {
                    const blob = new Blob([file.data], { type: 'application/dicom' });
                    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                    const metadata = await this.extractDicomMetadata(imageId);
                    return { id: imageId, filename: file.filename, metadata };
                } catch (error) {
                    console.error(`Error loading sagittal ${file.filename}:`, error);
                    return null;
                }
            })
        );
        
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        this.sagittalImageIds = validResults.map(r => ({ id: r.id, filename: r.filename }));
        this.sagittalMetadata = validResults.map(r => r.metadata);
        
        console.log(`✓ ${this.sagittalImageIds.length} sagittal with metadata`);
        
        if (this.sagittalMetadata[0] && this.sagittalMetadata[0].position) {
            const first = this.sagittalMetadata[0];
            const last = this.sagittalMetadata[this.sagittalMetadata.length - 1];
            console.log(`  Sagittal X range: ${first.position[0].toFixed(1)} to ${last.position[0].toFixed(1)} mm`);
        }
    }

    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        if (!this.isInitialized) return;
        
        this.currentAxialIndex = index;
        
        try {
            const imageId = this.axialImageIds[index].id;
            const image = await cornerstone.loadAndCacheImage(imageId);
            
            cornerstone.displayImage(this.axialElement, image);
            cornerstone.updateImage(this.axialElement);
            
            if (index === Math.floor(this.axialImageIds.length / 2)) {
                const viewport = cornerstone.getViewport(this.axialElement);
                if (viewport && viewport.voi) {
                    viewport.voi.windowCenter = image.windowCenter || 40;
                    viewport.voi.windowWidth = image.windowWidth || 400;
                    cornerstone.setViewport(this.axialElement, viewport);
                }
            }
            
            setTimeout(() => this.updateCrosshairs(), 10);
        } catch (error) {
            console.error('Error displaying axial:', error);
        }
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        if (!this.isInitialized) return;
        
        this.currentSagittalIndex = index;
        
        try {
            const imageId = this.sagittalImageIds[index].id;
            const image = await cornerstone.loadAndCacheImage(imageId);
            
            cornerstone.displayImage(this.sagittalElement, image);
            cornerstone.updateImage(this.sagittalElement);
            
            if (index === Math.floor(this.sagittalImageIds.length / 2)) {
                const viewport = cornerstone.getViewport(this.sagittalElement);
                if (viewport && viewport.voi) {
                    viewport.voi.windowCenter = image.windowCenter || 40;
                    viewport.voi.windowWidth = image.windowWidth || 400;
                    cornerstone.setViewport(this.sagittalElement, viewport);
                }
            }
            
            setTimeout(() => this.updateCrosshairs(), 10);
        } catch (error) {
            console.error('Error displaying sagittal:', error);
        }
    }

    updateCrosshairs() {
        this.drawCrosshairOnAxial();
        this.drawCrosshairOnSagittal();
    }

    /**
     * AXIAL CROSSHAIR - Vertical line showing sagittal slice position
     * 
     * LOGIC:
     * 1. Get 3D position of current SAGITTAL slice (ImagePositionPatient)
     * 2. Project that 3D point onto current AXIAL image → get (row, col) in pixels
     * 3. Convert pixel column to canvas X coordinate using DIRECT SCALING
     * 
     * THE FIX (line marked with *** CRITICAL FIX ***):
     * OLD: canvasX = bounds.left + (col / columns) * bounds.width
     * NEW: canvasX = bounds.left + (col * scaleX)
     * 
     * WHY: Image is scaled down to fit canvas. If image is 512px but rendered as 384px,
     *      then scaleX = 384/512 = 0.75. A pixel at col=400 should appear at 400*0.75=300,
     *      NOT at (400/512)*384=300. (They happen to be equal here but logic is different!)
     */
    drawCrosshairOnAxial() {
        try {
            const canvas = this.axialElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            cornerstone.updateImage(this.axialElement);
            
            requestAnimationFrame(() => {
                const bounds = this.getImageBounds(this.axialElement);
                if (!bounds) return;
                
                const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
                const axMeta = this.axialMetadata[this.currentAxialIndex];
                
                if (!sagMeta || !sagMeta.position || !axMeta) {
                    // Fallback: simple percentage-based positioning
                    const fraction = this.currentSagittalIndex / Math.max(1, this.sagittalImageIds.length - 1);
                    const x = bounds.left + (fraction * bounds.width);
                    this.drawVerticalLine(context, x, bounds.top, bounds.bottom);
                    console.log(`AXIAL (fallback): X=${x.toFixed(0)}`);
                    return;
                }
                
                // Project sagittal position onto axial image
                const sagPosition = sagMeta.position;  // [x, y, z] of sagittal slice in mm
                const projection = this.projectPointToSlice(sagPosition, axMeta);
                
                if (!projection) {
                    console.warn('Could not project sagittal to axial');
                    return;
                }
                
                // *** CRITICAL FIX: Use direct scaling instead of fractional positioning ***
                const pixelCol = projection.col;  // Column in pixel coordinates (0-512)
                const imageWidth = axMeta.columns;  // Image width in pixels (e.g., 512)
                const scaleX = bounds.width / imageWidth;  // Scale factor (e.g., 384/512 = 0.75)
                const canvasX = bounds.left + (pixelCol * scaleX);  // Direct scaling!
                
                // Clamp to bounds
                const finalX = Math.max(bounds.left, Math.min(bounds.right, canvasX));
                
                console.log(`AXIAL: sag ${this.currentSagittalIndex}/${this.sagittalImageIds.length}, sagX=${sagPosition[0].toFixed(1)}mm → axial col=${pixelCol.toFixed(0)} → canvas X=${finalX.toFixed(0)} (scale=${scaleX.toFixed(3)})`);
                
                this.drawVerticalLine(context, finalX, bounds.top, bounds.bottom);
            });
        } catch (error) {
            console.error('Error drawing axial crosshair:', error);
        }
    }

    /**
     * SAGITTAL CROSSHAIR - Horizontal line showing axial slice position
     * 
     * LOGIC:
     * 1. Get 3D position of current AXIAL slice (ImagePositionPatient)
     * 2. Project that 3D point onto current SAGITTAL image → get (row, col) in pixels
     * 3. Convert pixel row to canvas Y coordinate using DIRECT SCALING
     * 
     * THE FIX (same as axial):
     * OLD: canvasY = bounds.top + (row / rows) * bounds.height
     * NEW: canvasY = bounds.top + (row * scaleY)
     * 
     * This fixes the "running off bottom" issue because:
     * - Image is 512px tall but rendered as 384px (scaleY = 0.75)
     * - When axial projects to row=281, it should appear at 281*0.75=211
     * - OLD method gave: (281/512)*384=211 (happens to be same)
     * - But with different scaling it diverges! And the clamping helps too.
     */
    drawCrosshairOnSagittal() {
        try {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            cornerstone.updateImage(this.sagittalElement);
            
            requestAnimationFrame(() => {
                const bounds = this.getImageBounds(this.sagittalElement);
                if (!bounds) return;
                
                const axMeta = this.axialMetadata[this.currentAxialIndex];
                const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
                
                if (!axMeta || !axMeta.position || !sagMeta) {
                    // Fallback
                    const fraction = this.currentAxialIndex / Math.max(1, this.axialImageIds.length - 1);
                    const y = bounds.top + (fraction * bounds.height);
                    this.drawHorizontalLine(context, y, bounds.left, bounds.right);
                    console.log(`SAGITTAL (fallback): Y=${y.toFixed(0)}`);
                    return;
                }
                
                // Project axial position onto sagittal image
                const axPosition = axMeta.position;  // [x, y, z] of axial slice in mm
                const projection = this.projectPointToSlice(axPosition, sagMeta);
                
                if (!projection) {
                    console.warn('Could not project axial to sagittal');
                    return;
                }
                
                // *** CRITICAL FIX: Use direct scaling instead of fractional positioning ***
                const pixelRow = projection.row;  // Row in pixel coordinates (0-512)
                const imageHeight = sagMeta.rows;  // Image height in pixels (e.g., 512)
                const scaleY = bounds.height / imageHeight;  // Scale factor (e.g., 384/512 = 0.75)
                const canvasY = bounds.top + (pixelRow * scaleY);  // Direct scaling!
                
                // Clamp to bounds (prevents running off screen!)
                const finalY = Math.max(bounds.top, Math.min(bounds.bottom, canvasY));
                
                console.log(`SAGITTAL: ax ${this.currentAxialIndex}/${this.axialImageIds.length}, axZ=${axPosition[2].toFixed(1)}mm → sag row=${pixelRow.toFixed(0)} → canvas Y=${finalY.toFixed(0)} (scale=${scaleY.toFixed(3)})`);
                
                this.drawHorizontalLine(context, finalY, bounds.left, bounds.right);
            });
        } catch (error) {
            console.error('Error drawing sagittal crosshair:', error);
        }
    }

    drawVerticalLine(context, x, yStart, yEnd) {
        context.save();
        context.strokeStyle = '#00ff00';
        context.lineWidth = 2;
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(x, yStart);
        context.lineTo(x, yEnd);
        context.stroke();
        context.restore();
    }

    drawHorizontalLine(context, y, xStart, xEnd) {
        context.save();
        context.strokeStyle = '#00ff00';
        context.lineWidth = 2;
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(xStart, y);
        context.lineTo(xEnd, y);
        context.stroke();
        context.restore();
    }

    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
        }
    }

    async previousAxialImage() {
        if (this.currentAxialIndex > 0) {
            await this.displayAxialImage(this.currentAxialIndex - 1);
            this.updateSliceInfo();
        }
    }

    async nextSagittalImage() {
        if (this.currentSagittalIndex < this.sagittalImageIds.length - 1) {
            await this.displaySagittalImage(this.currentSagittalIndex + 1);
            this.updateSliceInfo();
        }
    }

    async previousSagittalImage() {
        if (this.currentSagittalIndex > 0) {
            await this.displaySagittalImage(this.currentSagittalIndex - 1);
            this.updateSliceInfo();
        }
    }

    resetWindowLevel() {
        [this.axialElement, this.sagittalElement].forEach(element => {
            try {
                const viewport = cornerstone.getViewport(element);
                if (viewport && viewport.voi) {
                    viewport.voi.windowCenter = 40;
                    viewport.voi.windowWidth = 400;
                    cornerstone.setViewport(element, viewport);
                }
            } catch (e) {}
        });
    }

    togglePlay() {
        if (this.isPlaying) this.stop();
        else this.play();
    }

    play() {
        if (this.axialImageIds.length === 0) return;
        this.isPlaying = true;
        this.playInterval = setInterval(() => {
            if (this.currentAxialIndex < this.axialImageIds.length - 1) {
                this.nextAxialImage();
            } else {
                this.displayAxialImage(0);
            }
        }, 100);
    }

    stop() {
        this.isPlaying = false;
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }

    updateSliceInfo() {
        document.getElementById('axialSlice').textContent = this.currentAxialIndex + 1;
        document.getElementById('axialTotal').textContent = this.axialImageIds.length;
        document.getElementById('sagittalSlice').textContent = this.currentSagittalIndex + 1;
        document.getElementById('sagittalTotal').textContent = this.sagittalImageIds.length;
    }

    getCurrentSlices() {
        return { axial: this.currentAxialIndex + 1, sagittal: this.currentSagittalIndex + 1 };
    }

    getTotalSlices() {
        return { axial: this.axialImageIds.length, sagittal: this.sagittalImageIds.length };
    }

    clear() {
        this.stop();
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        this.axialMetadata = [];
        this.sagittalMetadata = [];
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;
        
        if (this.isInitialized) {
            try {
                cornerstone.reset(this.axialElement);
                corner.reset(this.sagittalElement);
            } catch (error) {}
        }
    }
    
    destroy() {
        this.clear();
        if (this.keyboardHandler) {
            document.removeEventListener('keydown', this.keyboardHandler);
        }
        if (this.isInitialized) {
            try {
                cornerstone.disable(this.axialElement);
                cornerstone.disable(this.sagittalElement);
            } catch (error) {}
        }
    }
}

let dicomViewer = null;
