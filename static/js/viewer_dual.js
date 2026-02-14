// Dual-View DICOM Viewer with Crosshair Targeting using Cornerstone.js
class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
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

    // Load images for both views
    async loadDualSeries(axialFiles, sagittalFiles) {
        console.log(`Loading dual series: ${axialFiles.length} axial, ${sagittalFiles.length} sagittal`);
        
        // Load axial series
        if (axialFiles && axialFiles.length > 0) {
            this.axialImageIds = [];
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
            this.axialImageIds.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
            console.log(`✓ Loaded ${this.axialImageIds.length} axial images`);
        }

        // Load sagittal series
        if (sagittalFiles && sagittalFiles.length > 0) {
            this.sagittalImageIds = [];
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
            this.sagittalImageIds.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
            console.log(`✓ Loaded ${this.sagittalImageIds.length} sagittal images`);
        }

        // Display first images
        if (this.axialImageIds.length > 0) {
            await this.displayAxialImage(Math.floor(this.axialImageIds.length / 2)); // Start at middle
            
            // Force resize after a moment
            setTimeout(() => {
                try {
                    cornerstone.resize(this.axialElement, true);
                    this.drawCrosshair(this.axialElement, 'sagittal');
                    console.log('✓ Axial resized');
                } catch (e) {
                    console.error('Error resizing axial:', e);
                }
            }, 100);
        }

        if (this.sagittalImageIds.length > 0) {
            await this.displaySagittalImage(Math.floor(this.sagittalImageIds.length / 2)); // Start at middle
            
            // Force resize after a moment
            setTimeout(() => {
                try {
                    cornerstone.resize(this.sagittalElement, true);
                    this.drawCrosshair(this.sagittalElement, 'axial');
                    console.log('✓ Sagittal resized');
                } catch (e) {
                    console.error('Error resizing sagittal:', e);
                }
            }, 100);
        }

        this.updateSliceInfo();
    }

    // Display axial image with crosshair
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
            
            // Draw crosshair showing sagittal position
            this.drawCrosshair(this.axialElement, 'sagittal');
            
        } catch (error) {
            console.error('Error displaying axial image:', error);
        }
    }

    // Display sagittal image with crosshair
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
            
            // Draw crosshair showing axial position
            this.drawCrosshair(this.sagittalElement, 'axial');
            
        } catch (error) {
            console.error('Error displaying sagittal image:', error);
        }
    }

    // Draw crosshair line on the image
    drawCrosshair(element, orientation) {
        try {
            const canvas = element.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            const viewport = cornerstone.getViewport(element);
            
            // Redraw the image first to clear previous crosshair
            cornerstone.updateImage(element);
            
            // Calculate crosshair position
            let position;
            if (orientation === 'axial') {
                // Draw horizontal line on sagittal showing axial slice position
                position = (this.currentAxialIndex / Math.max(1, this.axialImageIds.length - 1)) * canvas.height;
            } else {
                // Draw vertical line on axial showing sagittal slice position
                position = (this.currentSagittalIndex / Math.max(1, this.sagittalImageIds.length - 1)) * canvas.width;
            }
            
            // Draw the crosshair line
            context.save();
            context.strokeStyle = '#00ff00'; // Bright green
            context.lineWidth = 2;
            context.setLineDash([5, 5]); // Dashed line
            
            context.beginPath();
            if (orientation === 'axial') {
                // Horizontal line
                context.moveTo(0, position);
                context.lineTo(canvas.width, position);
            } else {
                // Vertical line
                context.moveTo(position, 0);
                context.lineTo(position, canvas.height);
            }
            context.stroke();
            context.restore();
            
        } catch (error) {
            console.error('Error drawing crosshair:', error);
        }
    }

    // Navigation methods
    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
            // Update crosshair on sagittal view
            this.drawCrosshair(this.sagittalElement, 'axial');
        }
    }

    async previousAxialImage() {
        if (this.currentAxialIndex > 0) {
            await this.displayAxialImage(this.currentAxialIndex - 1);
            this.updateSliceInfo();
            // Update crosshair on sagittal view
            this.drawCrosshair(this.sagittalElement, 'axial');
        }
    }

    async nextSagittalImage() {
        if (this.currentSagittalIndex < this.sagittalImageIds.length - 1) {
            await this.displaySagittalImage(this.currentSagittalIndex + 1);
            this.updateSliceInfo();
            // Update crosshair on axial view
            this.drawCrosshair(this.axialElement, 'sagittal');
        }
    }

    async previousSagittalImage() {
        if (this.currentSagittalIndex > 0) {
            await this.displaySagittalImage(this.currentSagittalIndex - 1);
            this.updateSliceInfo();
            // Update crosshair on axial view
            this.drawCrosshair(this.axialElement, 'sagittal');
        }
    }

    // Reset window/level
    resetWindowLevel() {
        if (this.axialImageIds.length > 0) {
            const viewport = cornerstone.getViewport(this.axialElement);
            if (viewport && viewport.voi) {
                viewport.voi.windowCenter = 40;
                viewport.voi.windowWidth = 400;
                cornerstone.setViewport(this.axialElement, viewport);
            }
        }
        
        if (this.sagittalImageIds.length > 0) {
            const viewport = cornerstone.getViewport(this.sagittalElement);
            if (viewport && viewport.voi) {
                viewport.voi.windowCenter = 40;
                viewport.voi.windowWidth = 400;
                cornerstone.setViewport(this.sagittalElement, viewport);
            }
        }
    }

    // Toggle cine play
    togglePlay() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    // Start cine play
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

    // Stop cine play
    stop() {
        this.isPlaying = false;
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }

    // Update slice info in UI
    updateSliceInfo() {
        const axialSliceElement = document.getElementById('axialSlice');
        const axialTotalElement = document.getElementById('axialTotal');
        const sagittalSliceElement = document.getElementById('sagittalSlice');
        const sagittalTotalElement = document.getElementById('sagittalTotal');
        
        if (axialSliceElement) {
            axialSliceElement.textContent = this.currentAxialIndex + 1;
        }
        if (axialTotalElement) {
            axialTotalElement.textContent = this.axialImageIds.length;
        }
        if (sagittalSliceElement) {
            sagittalSliceElement.textContent = this.currentSagittalIndex + 1;
        }
        if (sagittalTotalElement) {
            sagittalTotalElement.textContent = this.sagittalImageIds.length;
        }
    }

    // Get current slice numbers
    getCurrentSlices() {
        return {
            axial: this.currentAxialIndex + 1,
            sagittal: this.currentSagittalIndex + 1
        };
    }

    // Get total slices
    getTotalSlices() {
        return {
            axial: this.axialImageIds.length,
            sagittal: this.sagittalImageIds.length
        };
    }

    // Clear viewer
    clear() {
        this.stop();
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;
        
        if (this.isInitialized) {
            try {
                cornerstone.reset(this.axialElement);
                cornerstone.reset(this.sagittalElement);
            } catch (error) {
                console.error('Error resetting cornerstone:', error);
            }
        }
    }
    
    // Cleanup
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
                console.error('Error disabling cornerstone:', error);
            }
        }
    }
}

// Create global dual viewer instance
let dicomViewer = null;
