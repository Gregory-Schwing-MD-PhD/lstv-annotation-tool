// DICOM Viewer using Cornerstone.js
class DicomViewer {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
        this.imageIds = [];
        this.currentImageIndex = 0;
        this.isPlaying = false;
        this.playInterval = null;
        this.isInitialized = false;
        
        if (!this.element) {
            console.error(`Element with ID '${elementId}' not found!`);
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
            
            // Enable the element for Cornerstone
            cornerstone.enable(this.element);
            this.isInitialized = true;
            
            // Setup event listeners
            this.setupEventListeners();
            
            console.log('✓ DICOM Viewer initialized');
        } catch (error) {
            console.error('Error initializing DICOM viewer:', error);
        }
    }

    setupEventListeners() {
        // Mouse wheel for scrolling slices
        this.element.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.previousImage();
            } else {
                this.nextImage();
            }
        });

        // Arrow keys for navigation - FIXED: Bound to document, not element
        this.keyboardHandler = (e) => {
            // Only handle if viewer has images loaded
            if (this.imageIds.length === 0) return;
            
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                this.previousImage();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                this.nextImage();
            } else if (e.key === ' ') {
                e.preventDefault();
                this.togglePlay();
            }
        };
        
        document.addEventListener('keydown', this.keyboardHandler);

        // Click and drag for window/level
        let startX, startY, startWL, startWW;
        let isDragging = false;

        this.element.addEventListener('mousedown', (e) => {
            if (this.imageIds.length === 0) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            try {
                const viewport = cornerstone.getViewport(this.element);
                if (viewport && viewport.voi) {
                    startWL = viewport.voi.windowCenter;
                    startWW = viewport.voi.windowWidth;
                }
            } catch (error) {
                console.error('Error getting viewport:', error);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging || this.imageIds.length === 0) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            const newWL = startWL + deltaY;
            const newWW = Math.max(1, startWW + deltaX);
            
            this.setWindowLevel(newWL, newWW);
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // Load images from array buffers
    async loadImages(files) {
        console.log(`Loading ${files.length} DICOM images...`);
        
        if (files.length === 0) {
            throw new Error('No DICOM files to load');
        }
        
        this.imageIds = [];
        
        for (const file of files) {
            try {
                // Create blob from array buffer
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                this.imageIds.push({
                    id: imageId,
                    filename: file.filename
                });
            } catch (error) {
                console.error(`Error loading ${file.filename}:`, error);
            }
        }

        // Sort by filename (assuming sequential naming like 001.dcm, 002.dcm)
        this.imageIds.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        console.log(`✓ Loaded ${this.imageIds.length} images`);
        
        // Display first image
        if (this.imageIds.length > 0) {
            console.log('Displaying first image...');
            
            // Force element to be visible before rendering
            this.element.style.display = 'block';
            this.element.style.width = '100%';
            this.element.style.height = '600px';
            
            await this.displayImage(0);
            
            // Force Cornerstone to resize/render
            setTimeout(() => {
                try {
                    cornerstone.resize(this.element, true);
                    console.log('✓ Cornerstone resized');
                } catch (e) {
                    console.error('Error resizing:', e);
                }
            }, 100);
            
            this.updateSliceInfo();
            console.log('✓ First image displayed');
        } else {
            throw new Error('No valid DICOM images loaded');
        }
    }

    // Display specific image
    async displayImage(index) {
        if (index < 0 || index >= this.imageIds.length) {
            console.error(`Invalid image index: ${index}`);
            return;
        }
        if (!this.isInitialized) {
            console.error('Viewer not initialized');
            return;
        }
        
        this.currentImageIndex = index;
        
        try {
            const imageId = this.imageIds[index].id;
            console.log(`Displaying image ${index + 1}/${this.imageIds.length}: ${imageId}`);
            
            const image = await cornerstone.loadAndCacheImage(imageId);
            
            // Actually display the image
            cornerstone.displayImage(this.element, image);
            
            // Force immediate render
            cornerstone.updateImage(this.element);
            
            // Check if canvas exists and has content
            const canvas = this.element.querySelector('canvas');
            if (canvas) {
                console.log(`Canvas exists: ${canvas.width}x${canvas.height}`);
            } else {
                console.error('❌ No canvas element found!');
            }
            
            // Set default window/level after first image loads
            if (index === 0) {
                const viewport = cornerstone.getViewport(this.element);
                if (viewport && viewport.voi) {
                    // Use image's default window/level if available
                    if (image.windowCenter && image.windowWidth) {
                        viewport.voi.windowCenter = image.windowCenter;
                        viewport.voi.windowWidth = image.windowWidth;
                        console.log(`Using image W/L: ${image.windowCenter}/${image.windowWidth}`);
                    } else {
                        // Fallback to reasonable defaults for T2 MRI
                        viewport.voi.windowCenter = 40;
                        viewport.voi.windowWidth = 400;
                        console.log('Using default W/L: 40/400');
                    }
                    cornerstone.setViewport(this.element, viewport);
                    
                    // Update UI controls
                    this.setWindowLevel(viewport.voi.windowCenter, viewport.voi.windowWidth);
                }
            }
            
            this.updateSliceInfo();
            console.log(`✓ Image ${index + 1} displayed successfully`);
        } catch (error) {
            console.error('Error displaying image:', error);
        }
    }

    // Navigate to next image
    async nextImage() {
        if (this.currentImageIndex < this.imageIds.length - 1) {
            await this.displayImage(this.currentImageIndex + 1);
        }
    }

    // Navigate to previous image
    async previousImage() {
        if (this.currentImageIndex > 0) {
            await this.displayImage(this.currentImageIndex - 1);
        }
    }

    // Set window level and width
    setWindowLevel(center, width) {
        if (!this.isInitialized || this.imageIds.length === 0) return;
        
        try {
            const viewport = cornerstone.getViewport(this.element);
            if (viewport && viewport.voi) {
                viewport.voi.windowCenter = center;
                viewport.voi.windowWidth = width;
                cornerstone.setViewport(this.element, viewport);
                
                // Update UI controls
                const wlControl = document.getElementById('windowLevel');
                const wwControl = document.getElementById('windowWidth');
                const wlValue = document.getElementById('windowLevelValue');
                const wwValue = document.getElementById('windowWidthValue');
                
                if (wlControl) wlControl.value = center;
                if (wwControl) wwControl.value = width;
                if (wlValue) wlValue.textContent = Math.round(center);
                if (wwValue) wwValue.textContent = Math.round(width);
            }
        } catch (error) {
            console.error('Error setting window level:', error);
        }
    }

    // Reset window/level
    resetWindowLevel() {
        this.setWindowLevel(0, 400);
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
        if (this.imageIds.length === 0) return;
        
        this.isPlaying = true;
        this.playInterval = setInterval(() => {
            if (this.currentImageIndex < this.imageIds.length - 1) {
                this.nextImage();
            } else {
                // Loop back to start
                this.displayImage(0);
            }
        }, 100); // 10 fps
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
        const currentSliceElement = document.getElementById('currentSlice');
        const totalSlicesElement = document.getElementById('totalSlices');
        
        if (currentSliceElement) {
            currentSliceElement.textContent = this.currentImageIndex + 1;
        }
        if (totalSlicesElement) {
            totalSlicesElement.textContent = this.imageIds.length;
        }
    }

    // Get current slice number
    getCurrentSlice() {
        return this.currentImageIndex + 1;
    }

    // Get total slices
    getTotalSlices() {
        return this.imageIds.length;
    }

    // Clear viewer
    clear() {
        this.stop();
        this.imageIds = [];
        this.currentImageIndex = 0;
        
        if (this.isInitialized) {
            try {
                cornerstone.reset(this.element);
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
                cornerstone.disable(this.element);
            } catch (error) {
                console.error('Error disabling cornerstone:', error);
            }
        }
    }
}

// Create global viewer instance
let dicomViewer = null;
