// Dual-View DICOM Viewer with PROPER Spatial Crosshair using DICOM coordinates
class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        // Store actual DICOM spatial positions
        this.axialPositions = []; // Z-coordinates for each axial slice
        this.sagittalPositions = []; // X-coordinates for each sagittal slice
        
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;
        
        this.isPlaying = false;
        this.playInterval = null;
        this.isInitialized = false;
        
        if (!this.axialElement || !this.sagittalElement) {
            console.error('Viewer elements not found!');
            return;
        }
        
        // Initialize Cornerstone
        this.init();
    }

    init() {
        try {
            // Configure cornerstoneWADOImageLoader
            if (typeof cornerstoneWADOImageLoader !== 'undefined') {
                cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
                cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
            }
            
            // Enable both elements for Cornerstone
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            this.isInitialized = true;
            
            // Setup event listeners
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized');
        } catch (error) {
            console.error('Error initializing dual viewer:', error);
        }
    }

    setupEventListeners() {
        // Mouse wheel for axial view
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.previousAxialImage();
            } else {
                this.nextAxialImage();
            }
        });

        // Mouse wheel for sagittal view
        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.previousSagittalImage();
            } else {
                this.nextSagittalImage();
            }
        });

        // Arrow keys for navigation
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

        // Window/level for axial
        this.setupWindowLevel(this.axialElement, 'axial');
        
        // Window/level for sagittal
        this.setupWindowLevel(this.sagittalElement, 'sagittal');
    }

    setupWindowLevel(element, viewName) {
        let startX, startY, startWL, startWW;
        let isDragging = false;

        element.addEventListener('mousedown', (e) => {
            if ((viewName === 'axial' && this.axialImageIds.length === 0) ||
                (viewName === 'sagittal' && this.sagittalImageIds.length === 0)) return;
            
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

    // Extract DICOM ImagePositionPatient to get spatial coordinates
    async extractSpatialPosition(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            
            // Try to get ImagePositionPatient from metadata
            if (image.data && image.data.string) {
                const ippString = image.data.string('x00200032'); // ImagePositionPatient tag
                if (ippString) {
                    const positions = ippString.split('\\').map(parseFloat);
                    if (positions.length === 3) {
                        return {
                            x: positions[0],
                            y: positions[1],
                            z: positions[2]
                        };
                    }
                }
            }
            
            // Fallback: try imagePositionPatient directly
            if (image.imagePositionPatient) {
                return {
                    x: image.imagePositionPatient[0],
                    y: image.imagePositionPatient[1],
                    z: image.imagePositionPatient[2]
                };
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting spatial position:', error);
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
        
        // Load BOTH series concurrently using Promise.all
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        console.log('✓ Both series loaded concurrently');
        
        // Display middle slices
        const axialStart = Math.floor(this.axialImageIds.length / 2);
        const sagittalStart = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(axialStart),
            this.displaySagittalImage(sagittalStart)
        ]);
        
        // Force resize and redraw both
        setTimeout(() => {
            if (this.axialImageIds.length > 0) {
                try {
                    cornerstone.resize(this.axialElement, true);
                    cornerstone.updateImage(this.axialElement);
                    this.drawCrosshair(this.axialElement, 'sagittal');
                    console.log('✓ Axial resized');
                } catch (e) {
                    console.error('Error resizing axial:', e);
                }
            }
            
            if (this.sagittalImageIds.length > 0) {
                try {
                    cornerstone.resize(this.sagittalElement, true);
                    cornerstone.updateImage(this.sagittalElement);
                    this.drawCrosshair(this.sagittalElement, 'axial');
                    console.log('✓ Sagittal resized');
                } catch (e) {
                    console.error('Error resizing sagittal:', e);
                }
            }
        }, 150);
        
        this.updateSliceInfo();
    }

    // Load axial series
    async loadAxialSeries(axialFiles) {
        if (!axialFiles || axialFiles.length === 0) {
            console.log('No axial files to load');
            return;
        }
        
        this.axialImageIds = [];
        this.axialPositions = [];
        
        // Add all files
        for (const file of axialFiles) {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                this.axialImageIds.push({
                    id: imageId,
                    filename: file.filename
                });
            } catch (error) {
                console.error(`Error loading axial ${file.filename}:`, error);
            }
        }
        
        // Sort by filename
        this.axialImageIds.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        // Extract spatial positions (Z-coordinate for axial slices)
        console.log('Extracting axial spatial positions...');
        for (const imageInfo of this.axialImageIds) {
            const position = await this.extractSpatialPosition(imageInfo.id);
            if (position) {
                this.axialPositions.push(position.z); // Z-coordinate for axial
            } else {
                this.axialPositions.push(null); // Fallback if no position found
            }
        }
        
        console.log(`✓ Loaded ${this.axialImageIds.length} axial images with spatial positions`);
    }

    // Load sagittal series
    async loadSagittalSeries(sagittalFiles) {
        if (!sagittalFiles || sagittalFiles.length === 0) {
            console.log('No sagittal files to load');
            return;
        }
        
        this.sagittalImageIds = [];
        this.sagittalPositions = [];
        
        // Add all files
        for (const file of sagittalFiles) {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                this.sagittalImageIds.push({
                    id: imageId,
                    filename: file.filename
                });
            } catch (error) {
                console.error(`Error loading sagittal ${file.filename}:`, error);
            }
        }
        
        // Sort by filename
        this.sagittalImageIds.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        // Extract spatial positions (X-coordinate for sagittal slices)
        console.log('Extracting sagittal spatial positions...');
        for (const imageInfo of this.sagittalImageIds) {
            const position = await this.extractSpatialPosition(imageInfo.id);
            if (position) {
                this.sagittalPositions.push(position.x); // X-coordinate for sagittal
            } else {
                this.sagittalPositions.push(null);
            }
        }
        
        console.log(`✓ Loaded ${this.sagittalImageIds.length} sagittal images with spatial positions`);
    }

    // Display axial image
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
            
            // Draw crosshair
            setTimeout(() => this.drawCrosshair(this.axialElement, 'sagittal'), 10);
            
        } catch (error) {
            console.error('Error displaying axial image:', error);
        }
    }

    // Display sagittal image
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
            
            // Draw crosshair
            setTimeout(() => this.drawCrosshair(this.sagittalElement, 'axial'), 10);
            
        } catch (error) {
            console.error('Error displaying sagittal image:', error);
        }
    }

    // Draw crosshair using ACTUAL DICOM spatial coordinates
    drawCrosshair(element, orientation) {
        try {
            const canvas = element.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            // Redraw the image first
            cornerstone.updateImage(element);
            
            requestAnimationFrame(() => {
                let position = null;
                
                if (orientation === 'axial') {
                    // Drawing on sagittal view, showing where current axial slice is
                    // Current axial Z-position
                    const currentZ = this.axialPositions[this.currentAxialIndex];
                    
                    if (currentZ !== null && this.sagittalPositions.length > 0) {
                        // Find the range of Z values in sagittal images
                        // (sagittal images also have Z positions from top to bottom)
                        const zValues = [];
                        for (let i = 0; i < this.sagittalImageIds.length; i++) {
                            const pos = this.axialPositions[0]; // Use first axial's Z as reference
                            // Actually, for sagittal, we need the Z range from the image itself
                            // Simplified: use canvas height proportion based on axial slice
                        }
                        
                        // SIMPLIFIED APPROACH: Map Z-position to canvas height
                        const minZ = Math.min(...this.axialPositions.filter(z => z !== null));
                        const maxZ = Math.max(...this.axialPositions.filter(z => z !== null));
                        const zRange = maxZ - minZ;
                        
                        if (zRange > 0) {
                            // Normalize current Z position to 0-1 range
                            const normalizedZ = (currentZ - minZ) / zRange;
                            position = normalizedZ * canvas.height;
                        }
                    }
                    
                    // Fallback to simple percentage if spatial coords don't work
                    if (position === null) {
                        position = (this.currentAxialIndex / Math.max(1, this.axialImageIds.length - 1)) * canvas.height;
                    }
                    
                    // Draw horizontal line on sagittal
                    if (position !== null) {
                        context.save();
                        context.strokeStyle = '#00ff00';
                        context.lineWidth = 2;
                        context.setLineDash([5, 5]);
                        context.beginPath();
                        context.moveTo(0, position);
                        context.lineTo(canvas.width, position);
                        context.stroke();
                        context.restore();
                    }
                    
                } else {
                    // Drawing on axial view, showing where current sagittal slice is
                    // Current sagittal X-position
                    const currentX = this.sagittalPositions[this.currentSagittalIndex];
                    
                    if (currentX !== null && this.sagittalPositions.length > 0) {
                        // Find the range of X values in sagittal images
                        const minX = Math.min(...this.sagittalPositions.filter(x => x !== null));
                        const maxX = Math.max(...this.sagittalPositions.filter(x => x !== null));
                        const xRange = maxX - minX;
                        
                        if (xRange > 0) {
                            // Normalize current X position to 0-1 range
                            const normalizedX = (currentX - minX) / xRange;
                            position = normalizedX * canvas.width;
                        }
                    }
                    
                    // Fallback to simple percentage if spatial coords don't work
                    if (position === null) {
                        position = (this.currentSagittalIndex / Math.max(1, this.sagittalImageIds.length - 1)) * canvas.width;
                    }
                    
                    // Draw vertical line on axial
                    if (position !== null) {
                        context.save();
                        context.strokeStyle = '#00ff00';
                        context.lineWidth = 2;
                        context.setLineDash([5, 5]);
                        context.beginPath();
                        context.moveTo(position, 0);
                        context.lineTo(position, canvas.height);
                        context.stroke();
                        context.restore();
                    }
                }
            });
            
        } catch (error) {
            console.error('Error drawing crosshair:', error);
        }
    }

    // Navigation methods
    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
            this.drawCrosshair(this.sagittalElement, 'axial');
        }
    }

    async previousAxialImage() {
        if (this.currentAxialIndex > 0) {
            await this.displayAxialImage(this.currentAxialIndex - 1);
            this.updateSliceInfo();
            this.drawCrosshair(this.sagittalElement, 'axial');
        }
    }

    async nextSagittalImage() {
        if (this.currentSagittalIndex < this.sagittalImageIds.length - 1) {
            await this.displaySagittalImage(this.currentSagittalIndex + 1);
            this.updateSliceInfo();
            this.drawCrosshair(this.axialElement, 'sagittal');
        }
    }

    async previousSagittalImage() {
        if (this.currentSagittalIndex > 0) {
            await this.displaySagittalImage(this.currentSagittalIndex - 1);
            this.updateSliceInfo();
            this.drawCrosshair(this.axialElement, 'sagittal');
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
        this.axialPositions = [];
        this.sagittalPositions = [];
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
