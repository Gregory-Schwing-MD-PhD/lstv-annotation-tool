// DICOM Viewer using Cornerstone.js
class DicomViewer {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
        this.imageIds = [];
        this.currentImageIndex = 0;
        this.isPlaying = false;
        this.playInterval = null;
        
        // Initialize Cornerstone
        this.init();
    }

    init() {
        // Configure cornerstoneWADOImageLoader
        cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
        cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
        
        // Enable the element for Cornerstone
        cornerstone.enable(this.element);
        
        // Setup event listeners
        this.setupEventListeners();
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

        // Arrow keys for navigation
        document.addEventListener('keydown', (e) => {
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
        });

        // Click and drag for window/level
        let startX, startY, startWL, startWW;
        let isDragging = false;

        this.element.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const viewport = cornerstone.getViewport(this.element);
            startWL = viewport.voi.windowCenter;
            startWW = viewport.voi.windowWidth;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
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
        this.imageIds.sort((a, b) => a.filename.localeCompare(b.filename));
        
        console.log(`Loaded ${this.imageIds.length} images`);
        
        // Display first image
        if (this.imageIds.length > 0) {
            await this.displayImage(0);
            this.updateSliceInfo();
        }
    }

    // Display specific image
    async displayImage(index) {
        if (index < 0 || index >= this.imageIds.length) return;
        
        this.currentImageIndex = index;
        
        try {
            const imageId = this.imageIds[index].id;
            await cornerstone.loadAndCacheImage(imageId);
            
            cornerstone.displayImage(this.element, await cornerstone.loadImage(imageId));
            
            this.updateSliceInfo();
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
        const viewport = cornerstone.getViewport(this.element);
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
        cornerstone.reset(this.element);
    }
}

// Create global viewer instance
let dicomViewer = null;
