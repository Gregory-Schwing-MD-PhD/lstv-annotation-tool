/**
 * Dual-View DICOM Viewer with PROPER Spatial Coordinate Mapping
 * 
 * BASED ON: RSNA 2024 2nd Place Kaggle Solution
 * 
 * KEY DICOM METADATA USED:
 * 1. ImagePositionPatient [x, y, z] - Position of top-left pixel in world coords (mm)
 * 2. ImageOrientationPatient [rowX, rowY, rowZ, colX, colY, colZ] - Direction cosines
 * 3. PixelSpacing [row_spacing, col_spacing] - Physical distance between pixels (mm)
 * 
 * COORDINATE SYSTEM:
 * - X: Left(-) to Right(+)  (patient's left/right)
 * - Y: Posterior(-) to Anterior(+)  (back to front)
 * - Z: Inferior(-) to Superior(+)  (feet to head)
 * 
 * CROSSHAIR LOGIC (from Kaggle):
 * 1. Get ImagePositionPatient for current slice in one view
 * 2. Get ImageOrientationPatient to calculate plane normal
 * 3. Project that 3D point onto the other view's slices
 * 4. Find closest slice and calculate pixel position
 */

class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        // Store DICOM spatial metadata for each slice
        this.axialMetadata = [];  // {position: [x,y,z], orientation: [...], spacing: [row,col]}
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
     * Returns: {position: [x,y,z], orientation: [6 values], spacing: [row,col], rows, columns}
     */
    async extractDicomMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            
            const metadata = {
                position: null,      // ImagePositionPatient [x, y, z]
                orientation: null,   // ImageOrientationPatient [rowX, rowY, rowZ, colX, colY, colZ]
                spacing: null,       // PixelSpacing [row, col]
                rows: image.rows || 512,
                columns: image.columns || 512
            };
            
            // Try to get from DICOM data tags
            if (image.data && image.data.string) {
                // ImagePositionPatient (0020,0032)
                const ipp = image.data.string('x00200032');
                if (ipp) {
                    metadata.position = ipp.split('\\').map(parseFloat);
                }
                
                // ImageOrientationPatient (0020,0037)
                const iop = image.data.string('x00200037');
                if (iop) {
                    metadata.orientation = iop.split('\\').map(parseFloat);
                }
                
                // PixelSpacing (0028,0030)
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
     * Calculate plane normal vector from ImageOrientationPatient
     * ImageOrientationPatient = [rowX, rowY, rowZ, colX, colY, colZ]
     * Normal = cross product of row and column vectors
     */
    calculatePlaneNormal(orientation) {
        if (!orientation || orientation.length !== 6) return null;
        
        // Row direction cosines
        const row = [orientation[0], orientation[1], orientation[2]];
        // Column direction cosines
        const col = [orientation[3], orientation[4], orientation[5]];
        
        // Cross product: row × col
        const normal = [
            row[1] * col[2] - row[2] * col[1],
            row[2] * col[0] - row[0] * col[2],
            row[0] * col[1] - row[1] * col[0]
        ];
        
        return normal;
    }

    /**
     * Project a 3D world point onto an image slice
     * Returns pixel coordinates (row, col) on that slice
     */
    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata.position || !sliceMetadata.orientation || !sliceMetadata.spacing) {
            return null;
        }
        
        const [px, py, pz] = worldPoint;  // Point to project
        const [sx, sy, sz] = sliceMetadata.position;  // Slice origin
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;
        
        // Vector from slice origin to point
        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;
        
        // Project onto row direction (gives column index)
        const col = (dx * rowX + dy * rowY + dz * rowZ) / rowSpacing;
        
        // Project onto column direction (gives row index)
        const row = (dx * colX + dy * colY + dz * colZ) / colSpacing;
        
        return {row, col};
    }

    getImageBounds(element) {
        try {
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) return null;
            
            const image = enabledElement.image;
            const viewport = enabledElement.viewport;
            const canvas = enabledElement.canvas;
            
            const scale = viewport.scale || 1;
            const renderedWidth = image.width * scale;
            const renderedHeight = image.height * scale;
            
            const translation = viewport.translation || { x: 0, y: 0 };
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            
            const left = (canvasWidth / 2) - (renderedWidth / 2) + translation.x;
            const top = (canvasHeight / 2) - (renderedHeight / 2) + translation.y;
            
            return {
                left, top,
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
        
        // Load BOTH series in parallel with metadata extraction
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
     * Each slice gets: position, orientation, spacing
     */
    async loadAxialSeries(axialFiles) {
        if (!axialFiles || axialFiles.length === 0) return;
        
        this.axialImageIds = [];
        this.axialMetadata = [];
        
        // Load ALL files in parallel with metadata
        const results = await Promise.all(
            axialFiles.map(async (file) => {
                try {
                    const blob = new Blob([file.data], { type: 'application/dicom' });
                    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                    
                    // CRITICAL: Extract DICOM metadata
                    const metadata = await this.extractDicomMetadata(imageId);
                    
                    return { id: imageId, filename: file.filename, metadata };
                } catch (error) {
                    console.error(`Error loading axial ${file.filename}:`, error);
                    return null;
                }
            })
        );
        
        // Sort and store
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        this.axialImageIds = validResults.map(r => ({ id: r.id, filename: r.filename }));
        this.axialMetadata = validResults.map(r => r.metadata);
        
        console.log(`✓ ${this.axialImageIds.length} axial with metadata`);
        
        // Log sample metadata
        if (this.axialMetadata[0] && this.axialMetadata[0].position) {
            const first = this.axialMetadata[0];
            const last = this.axialMetadata[this.axialMetadata.length - 1];
            console.log(`  Axial Z range: ${first.position[2].toFixed(1)} to ${last.position[2].toFixed(1)} mm`);
        }
    }

    /**
     * Load sagittal series with DICOM metadata extraction
     */
    async loadSagittalSeries(sagittalFiles) {
        if (!sagittalFiles || sagittalFiles.length === 0) return;
        
        this.sagittalImageIds = [];
        this.sagittalMetadata = [];
        
        // Load ALL files in parallel with metadata
        const results = await Promise.all(
            sagittalFiles.map(async (file) => {
                try {
                    const blob = new Blob([file.data], { type: 'application/dicom' });
                    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                    
                    // CRITICAL: Extract DICOM metadata
                    const metadata = await this.extractDicomMetadata(imageId);
                    
                    return { id: imageId, filename: file.filename, metadata };
                } catch (error) {
                    console.error(`Error loading sagittal ${file.filename}:`, error);
                    return null;
                }
            })
        );
        
        // Sort and store
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        this.sagittalImageIds = validResults.map(r => ({ id: r.id, filename: r.filename }));
        this.sagittalMetadata = validResults.map(r => r.metadata);
        
        console.log(`✓ ${this.sagittalImageIds.length} sagittal with metadata`);
        
        // Log sample metadata
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
     * AXIAL CROSSHAIR - Like Kaggle solution
     * 
     * WHAT WE'RE DOING:
     * 1. Get 3D world position of current SAGITTAL slice (its ImagePositionPatient)
     * 2. Map that 3D point to a pixel (col, row) on the AXIAL image
     * 3. Draw vertical line at that column position
     * 
     * WHY: Sagittal slices have different X positions (left-right)
     *      Axial image columns also represent X positions (left-right)
     *      So we map sagittal X → axial column
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
                
                // Get current sagittal slice metadata
                const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
                const axMeta = this.axialMetadata[this.currentAxialIndex];
                
                if (!sagMeta || !sagMeta.position || !axMeta) {
                    // Fallback to simple mapping
                    const fraction = this.currentSagittalIndex / Math.max(1, this.sagittalImageIds.length - 1);
                    const x = bounds.left + (fraction * bounds.width);
                    this.drawVerticalLine(context, x, bounds.top, bounds.bottom);
                    console.log(`AXIAL (fallback): X=${x.toFixed(0)}`);
                    return;
                }
                
                // KAGGLE METHOD: Project sagittal position onto axial image
                const sagPosition = sagMeta.position;  // [x, y, z] of sagittal slice
                
                // Project this 3D point onto current axial slice
                const projection = this.projectPointToSlice(sagPosition, axMeta);
                
                if (!projection) {
                    console.warn('Could not project sagittal position to axial');
                    return;
                }
                
                // Convert pixel coordinates to canvas coordinates
                const pixelCol = projection.col;
                const fractionX = pixelCol / axMeta.columns;
                const canvasX = bounds.left + (fractionX * bounds.width);
                
                console.log(`AXIAL: sag ${this.currentSagittalIndex}/${this.sagittalImageIds.length}, sagX=${sagPosition[0].toFixed(1)}mm → axial col=${pixelCol.toFixed(0)} → canvas X=${canvasX.toFixed(0)}`);
                
                this.drawVerticalLine(context, canvasX, bounds.top, bounds.bottom);
            });
        } catch (error) {
            console.error('Error drawing axial crosshair:', error);
        }
    }

    /**
     * SAGITTAL CROSSHAIR - Like Kaggle solution
     * 
     * WHAT WE'RE DOING:
     * 1. Get 3D world position of current AXIAL slice (its ImagePositionPatient Z coordinate)
     * 2. Map that Z position to a pixel row on the SAGITTAL image
     * 3. Draw horizontal line at that row position
     * 
     * WHY: Axial slices have different Z positions (head-feet)
     *      Sagittal image rows also represent Z positions (head-feet)
     *      So we map axial Z → sagittal row
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
                
                // Get current axial slice metadata
                const axMeta = this.axialMetadata[this.currentAxialIndex];
                const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
                
                if (!axMeta || !axMeta.position || !sagMeta) {
                    // Fallback to simple mapping
                    const fraction = this.currentAxialIndex / Math.max(1, this.axialImageIds.length - 1);
                    const y = bounds.top + (fraction * bounds.height);
                    this.drawHorizontalLine(context, y, bounds.left, bounds.right);
                    console.log(`SAGITTAL (fallback): Y=${y.toFixed(0)}`);
                    return;
                }
                
                // KAGGLE METHOD: Project axial position onto sagittal image
                const axPosition = axMeta.position;  // [x, y, z] of axial slice
                
                // Project this 3D point onto current sagittal slice
                const projection = this.projectPointToSlice(axPosition, sagMeta);
                
                if (!projection) {
                    console.warn('Could not project axial position to sagittal');
                    return;
                }
                
                // Convert pixel coordinates to canvas coordinates
                const pixelRow = projection.row;
                const fractionY = pixelRow / sagMeta.rows;
                const canvasY = bounds.top + (fractionY * bounds.height);
                
                console.log(`SAGITTAL: ax ${this.currentAxialIndex}/${this.axialImageIds.length}, axZ=${axPosition[2].toFixed(1)}mm → sag row=${pixelRow.toFixed(0)} → canvas Y=${canvasY.toFixed(0)}`);
                
                this.drawHorizontalLine(context, canvasY, bounds.left, bounds.right);
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
                cornerstone.reset(this.sagittalElement);
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
