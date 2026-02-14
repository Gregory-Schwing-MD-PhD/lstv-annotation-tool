// Dual-View DICOM Viewer with PROPER coordinate system synchronization
class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        // Store DICOM metadata for each slice
        this.axialMetadata = []; // {position: [x,y,z], spacing: [x,y], orientation: [...]}
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
        // Mouse wheel
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.previousAxialImage();
            } else {
                this.nextAxialImage();
            }
        });

        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.previousSagittalImage();
            } else {
                this.nextSagittalImage();
            }
        });

        // Arrow keys
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

        // Window/level
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
            } catch (error) {
                console.error('Error getting viewport:', error);
            }
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
            } catch (error) {
                console.error('Error setting viewport:', error);
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // Extract DICOM metadata from image
    async extractMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            
            const metadata = {
                position: null,
                spacing: null,
                orientation: null,
                rows: image.rows || 512,
                columns: image.columns || 512
            };
            
            // Try to get ImagePositionPatient (x, y, z in mm)
            if (image.data && image.data.string) {
                const ipp = image.data.string('x00200032');
                if (ipp) {
                    const pos = ipp.split('\\').map(parseFloat);
                    if (pos.length === 3) {
                        metadata.position = pos;
                    }
                }
                
                const ps = image.data.string('x00280030');
                if (ps) {
                    const spacing = ps.split('\\').map(parseFloat);
                    if (spacing.length === 2) {
                        metadata.spacing = spacing;
                    }
                }
                
                const iop = image.data.string('x00200037');
                if (iop) {
                    const orient = iop.split('\\').map(parseFloat);
                    if (orient.length === 6) {
                        metadata.orientation = orient;
                    }
                }
            }
            
            // Fallback to direct properties
            if (!metadata.position && image.imagePositionPatient) {
                metadata.position = image.imagePositionPatient;
            }
            if (!metadata.spacing && image.pixelSpacing) {
                metadata.spacing = image.pixelSpacing;
            }
            if (!metadata.orientation && image.imageOrientationPatient) {
                metadata.orientation = image.imageOrientationPatient;
            }
            
            return metadata;
        } catch (error) {
            console.error('Error extracting metadata:', error);
            return null;
        }
    }

    // Load images for both views CONCURRENTLY
    async loadDualSeries(axialFiles, sagittalFiles) {
        console.log(`Loading dual series: ${axialFiles.length} axial, ${sagittalFiles.length} sagittal`);
        
        // Make both viewers visible FIRST
        this.axialElement.style.display = 'block';
        this.axialElement.style.width = '100%';
        this.axialElement.style.height = '600px';
        
        this.sagittalElement.style.display = 'block';
        this.sagittalElement.style.width = '100%';
        this.sagittalElement.style.height = '600px';
        
        // Load BOTH series concurrently
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        console.log('✓ Both series loaded');
        
        // Find middle slices
        const axialStart = Math.floor(this.axialImageIds.length / 2);
        const sagittalStart = Math.floor(this.sagittalImageIds.length / 2);
        
        // Display both concurrently
        await Promise.all([
            this.displayAxialImage(axialStart),
            this.displaySagittalImage(sagittalStart)
        ]);
        
        // Resize after a moment
        setTimeout(() => {
            try {
                cornerstone.resize(this.axialElement, true);
                cornerstone.updateImage(this.axialElement);
                this.updateCrosshairs();
                console.log('✓ Axial resized');
            } catch (e) {
                console.error('Error resizing axial:', e);
            }
            
            try {
                cornerstone.resize(this.sagittalElement, true);
                cornerstone.updateImage(this.sagittalElement);
                this.updateCrosshairs();
                console.log('✓ Sagittal resized');
            } catch (e) {
                console.error('Error resizing sagittal:', e);
            }
        }, 150);
        
        this.updateSliceInfo();
    }

    async loadAxialSeries(axialFiles) {
        if (!axialFiles || axialFiles.length === 0) return;
        
        this.axialImageIds = [];
        this.axialMetadata = [];
        
        for (const file of axialFiles) {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                this.axialImageIds.push({ id: imageId, filename: file.filename });
            } catch (error) {
                console.error(`Error loading axial ${file.filename}:`, error);
            }
        }
        
        this.axialImageIds.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        // Extract metadata
        console.log('Extracting axial metadata...');
        for (const imageInfo of this.axialImageIds) {
            const metadata = await this.extractMetadata(imageInfo.id);
            this.axialMetadata.push(metadata);
        }
        
        console.log(`✓ Loaded ${this.axialImageIds.length} axial images`);
    }

    async loadSagittalSeries(sagittalFiles) {
        if (!sagittalFiles || sagittalFiles.length === 0) return;
        
        this.sagittalImageIds = [];
        this.sagittalMetadata = [];
        
        for (const file of sagittalFiles) {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                this.sagittalImageIds.push({ id: imageId, filename: file.filename });
            } catch (error) {
                console.error(`Error loading sagittal ${file.filename}:`, error);
            }
        }
        
        this.sagittalImageIds.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        // Extract metadata
        console.log('Extracting sagittal metadata...');
        for (const imageInfo of this.sagittalImageIds) {
            const metadata = await this.extractMetadata(imageInfo.id);
            this.sagittalMetadata.push(metadata);
        }
        
        console.log(`✓ Loaded ${this.sagittalImageIds.length} sagittal images`);
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
            
            // Set window/level on first load
            if (index === Math.floor(this.axialImageIds.length / 2)) {
                const viewport = cornerstone.getViewport(this.axialElement);
                if (viewport && viewport.voi) {
                    if (image.windowCenter && image.windowWidth) {
                        viewport.voi.windowCenter = image.windowCenter;
                        viewport.voi.windowWidth = image.windowWidth;
                    } else {
                        viewport.voi.windowCenter = 40;
                        viewport.voi.windowWidth = 400;
                    }
                    cornerstone.setViewport(this.axialElement, viewport);
                }
            }
            
            setTimeout(() => this.updateCrosshairs(), 10);
            
        } catch (error) {
            console.error('Error displaying axial image:', error);
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
            
            // Set window/level on first load
            if (index === Math.floor(this.sagittalImageIds.length / 2)) {
                const viewport = cornerstone.getViewport(this.sagittalElement);
                if (viewport && viewport.voi) {
                    if (image.windowCenter && image.windowWidth) {
                        viewport.voi.windowCenter = image.windowCenter;
                        viewport.voi.windowWidth = image.windowWidth;
                    } else {
                        viewport.voi.windowCenter = 40;
                        viewport.voi.windowWidth = 400;
                    }
                    cornerstone.setViewport(this.sagittalElement, viewport);
                }
            }
            
            setTimeout(() => this.updateCrosshairs(), 10);
            
        } catch (error) {
            console.error('Error displaying sagittal image:', error);
        }
    }

    // Update BOTH crosshairs at once
    updateCrosshairs() {
        this.drawCrosshairOnAxial();
        this.drawCrosshairOnSagittal();
    }

    // Draw crosshair on AXIAL showing current sagittal X-position
    drawCrosshairOnAxial() {
        try {
            const canvas = this.axialElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            // Redraw image first
            cornerstone.updateImage(this.axialElement);
            
            requestAnimationFrame(() => {
                // Get current sagittal X-position (in world coordinates)
                const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
                if (!sagMeta || !sagMeta.position) {
                    // Fallback: just use percentage
                    const x = (this.currentSagittalIndex / Math.max(1, this.sagittalImageIds.length - 1)) * canvas.width;
                    this.drawVerticalLine(context, canvas, x);
                    return;
                }
                
                const sagX = sagMeta.position[0]; // World X of current sagittal slice
                
                // Get axial metadata
                const axMeta = this.axialMetadata[this.currentAxialIndex];
                if (!axMeta || !axMeta.position || !axMeta.spacing) {
                    const x = (this.currentSagittalIndex / Math.max(1, this.sagittalImageIds.length - 1)) * canvas.width;
                    this.drawVerticalLine(context, canvas, x);
                    return;
                }
                
                // Convert world X to pixel X on this axial slice
                // ImagePosition gives top-left corner position
                // We need to find where sagX falls in the axial image
                const axialX0 = axMeta.position[0]; // X at pixel column 0
                const pixelSpacingX = axMeta.spacing[0]; // mm per pixel in X
                
                // Calculate pixel column
                const pixelX = (sagX - axialX0) / pixelSpacingX;
                
                // Map to canvas coordinates
                const canvasX = (pixelX / axMeta.columns) * canvas.width;
                
                // Clamp to canvas bounds
                const finalX = Math.max(0, Math.min(canvas.width, canvasX));
                
                this.drawVerticalLine(context, canvas, finalX);
            });
            
        } catch (error) {
            console.error('Error drawing axial crosshair:', error);
        }
    }

    // Draw crosshair on SAGITTAL showing current axial Z-position
    drawCrosshairOnSagittal() {
        try {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            // Redraw image first
            cornerstone.updateImage(this.sagittalElement);
            
            requestAnimationFrame(() => {
                // Get current axial Z-position (in world coordinates)
                const axMeta = this.axialMetadata[this.currentAxialIndex];
                if (!axMeta || !axMeta.position) {
                    // Fallback: just use percentage
                    const y = (this.currentAxialIndex / Math.max(1, this.axialImageIds.length - 1)) * canvas.height;
                    this.drawHorizontalLine(context, canvas, y);
                    return;
                }
                
                const axZ = axMeta.position[2]; // World Z of current axial slice
                
                // Get sagittal metadata
                const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
                if (!sagMeta || !sagMeta.position || !sagMeta.spacing) {
                    const y = (this.currentAxialIndex / Math.max(1, this.axialImageIds.length - 1)) * canvas.height;
                    this.drawHorizontalLine(context, canvas, y);
                    return;
                }
                
                // For sagittal view:
                // - Columns (X) represent anterior-posterior
                // - Rows (Y) represent superior-inferior (Z in world coords)
                
                // We need to find which row corresponds to axZ
                // Sagittal ImagePosition gives top-left corner
                const sagZ0 = sagMeta.position[2]; // Z at pixel row 0
                const pixelSpacingY = sagMeta.spacing[1]; // mm per pixel in Y (which is Z-direction)
                
                // Calculate pixel row
                const pixelY = (sagZ0 - axZ) / pixelSpacingY; // Note: Z usually decreases going down
                
                // Map to canvas coordinates
                const canvasY = (pixelY / sagMeta.rows) * canvas.height;
                
                // Clamp to canvas bounds
                const finalY = Math.max(0, Math.min(canvas.height, canvasY));
                
                this.drawHorizontalLine(context, canvas, finalY);
            });
            
        } catch (error) {
            console.error('Error drawing sagittal crosshair:', error);
        }
    }

    drawVerticalLine(context, canvas, x) {
        context.save();
        context.strokeStyle = '#00ff00';
        context.lineWidth = 2;
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
        context.restore();
    }

    drawHorizontalLine(context, canvas, y) {
        context.save();
        context.strokeStyle = '#00ff00';
        context.lineWidth = 2;
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
        context.restore();
    }

    // Navigation
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
        if (this.axialImageIds.length > 0) {
            try {
                const viewport = cornerstone.getViewport(this.axialElement);
                if (viewport && viewport.voi) {
                    viewport.voi.windowCenter = 40;
                    viewport.voi.windowWidth = 400;
                    cornerstone.setViewport(this.axialElement, viewport);
                }
            } catch (e) {
                console.error('Error resetting axial:', e);
            }
        }
        
        if (this.sagittalImageIds.length > 0) {
            try {
                const viewport = cornerstone.getViewport(this.sagittalElement);
                if (viewport && viewport.voi) {
                    viewport.voi.windowCenter = 40;
                    viewport.voi.windowWidth = 400;
                    cornerstone.setViewport(this.sagittalElement, viewport);
                }
            } catch (e) {
                console.error('Error resetting sagittal:', e);
            }
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
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
        const axialSliceElement = document.getElementById('axialSlice');
        const axialTotalElement = document.getElementById('axialTotal');
        const sagittalSliceElement = document.getElementById('sagittalSlice');
        const sagittalTotalElement = document.getElementById('sagittalTotal');
        
        if (axialSliceElement) axialSliceElement.textContent = this.currentAxialIndex + 1;
        if (axialTotalElement) axialTotalElement.textContent = this.axialImageIds.length;
        if (sagittalSliceElement) sagittalSliceElement.textContent = this.currentSagittalIndex + 1;
        if (sagittalTotalElement) sagittalTotalElement.textContent = this.sagittalImageIds.length;
    }

    getCurrentSlices() {
        return {
            axial: this.currentAxialIndex + 1,
            sagittal: this.currentSagittalIndex + 1
        };
    }

    getTotalSlices() {
        return {
            axial: this.axialImageIds.length,
            sagittal: this.sagittalImageIds.length
        };
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
            } catch (error) {
                console.error('Error resetting:', error);
            }
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
            } catch (error) {
                console.error('Error disabling:', error);
            }
        }
    }
}

let dicomViewer = null;
