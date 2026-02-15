// viewer_dual.js - Dual-view DICOM viewer with crosshairs and synchronized navigation
// CRITICAL: This file must be loaded AFTER cornerstone-core and cornerstone-wado-image-loader

// =============================================================================
// STEP 1: CRITICAL CODEC CONFIGURATION (Must be first!)
// =============================================================================
// This configuration is MANDATORY to prevent "decodeTask" errors
cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

// Initialize web workers with explicit codec paths
cornerstoneWADOImageLoader.webWorkerManager.initialize({
    maxWebWorkers: 4,
    startWebWorkersOnDemand: true,
    taskConfiguration: {
        decodeTask: {
            loadCodecsOnStartup: true,
            initializeCodecsOnStartup: false,
            codecsPath: 'https://unpkg.com/cornerstone-wado-image-loader@4.1.3/dist/codecs/',
            usePDFJS: false
        }
    }
});

console.log('✓ Cornerstone WADO Image Loader configured with codec support');

// =============================================================================
// STEP 2: DICOM Viewer Module
// =============================================================================
const dicomViewer = {
    axialElement: null,
    sagittalElement: null,
    axialImageIds: [],
    sagittalImageIds: [],
    currentAxialIndex: 0,
    currentSagittalIndex: 0,
    isInitialized: false,

    // Initialize both viewers
    async init() {
        console.log('Initializing dual DICOM viewers...');
        
        this.axialElement = document.getElementById('axialViewer');
        this.sagittalElement = document.getElementById('sagittalViewer');

        if (!this.axialElement || !this.sagittalElement) {
            throw new Error('Viewer elements not found in DOM');
        }

        // Verify elements have dimensions (critical for Cornerstone)
        const axialRect = this.axialElement.getBoundingClientRect();
        const sagittalRect = this.sagittalElement.getBoundingClientRect();
        
        console.log('Axial viewer dimensions:', axialRect.width, 'x', axialRect.height);
        console.log('Sagittal viewer dimensions:', sagittalRect.width, 'x', sagittalRect.height);

        if (axialRect.width === 0 || axialRect.height === 0) {
            throw new Error('Axial viewer element has no dimensions. Ensure display is not "none".');
        }
        if (sagittalRect.width === 0 || sagittalRect.height === 0) {
            throw new Error('Sagittal viewer element has no dimensions. Ensure display is not "none".');
        }

        // Enable both elements for Cornerstone
        cornerstone.enable(this.axialElement);
        cornerstone.enable(this.sagittalElement);

        // Set up crosshair synchronization
        this.setupCrosshairs();

        // Set up keyboard navigation
        this.setupKeyboardControls();

        this.isInitialized = true;
        console.log('✓ Dual viewers initialized successfully');
    },

    // Load both series with automatic crosshair setup
    async loadDualSeries(axialFiles, sagittalFiles) {
        if (!this.isInitialized) {
            await this.init();
        }

        console.log(`Loading ${axialFiles.length} axial + ${sagittalFiles.length} sagittal images...`);
        
        // Convert files to Cornerstone image IDs
        // Files should be objects with { filename, data } structure from storageManager
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        for (const file of axialFiles) {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                this.axialImageIds.push(imageId);
            } catch (error) {
                console.error('Error adding axial file:', file.filename, error);
            }
        }
        
        for (const file of sagittalFiles) {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                this.sagittalImageIds.push(imageId);
            } catch (error) {
                console.error('Error adding sagittal file:', file.filename, error);
            }
        }

        console.log(`Created ${this.axialImageIds.length} axial + ${this.sagittalImageIds.length} sagittal image IDs`);

        // Load and display first images
        try {
            // Load middle slices for both views
            this.currentAxialIndex = Math.floor(this.axialImageIds.length / 2);
            this.currentSagittalIndex = Math.floor(this.sagittalImageIds.length / 2);

            await this.displayAxialImage(this.currentAxialIndex);
            await this.displaySagittalImage(this.currentSagittalIndex);

            // Update UI counters
            this.updateSliceCounters();

            console.log('✓ Both series loaded successfully');
        } catch (error) {
            console.error('Error loading series:', error);
            throw error;
        }
    },

    // Display axial image at specific index
    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        
        this.currentAxialIndex = index;
        const imageId = this.axialImageIds[index];

        try {
            const image = await cornerstone.loadImage(imageId);
            const viewport = cornerstone.getDefaultViewportForImage(this.axialElement, image);
            
            // Apply common windowing for CT
            viewport.voi.windowWidth = 400;
            viewport.voi.windowCenter = 40;

            cornerstone.displayImage(this.axialElement, image, viewport);
            this.updateCrosshairs();
        } catch (error) {
            console.error('Error displaying axial image:', error);
            throw error;
        }
    },

    // Display sagittal image at specific index
    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        
        this.currentSagittalIndex = index;
        const imageId = this.sagittalImageIds[index];

        try {
            const image = await cornerstone.loadImage(imageId);
            const viewport = cornerstone.getDefaultViewportForImage(this.sagittalElement, image);
            
            // Apply common windowing for CT
            viewport.voi.windowWidth = 400;
            viewport.voi.windowCenter = 40;

            cornerstone.displayImage(this.sagittalElement, image, viewport);
            this.updateCrosshairs();
        } catch (error) {
            console.error('Error displaying sagittal image:', error);
            throw error;
        }
    },

    // Setup crosshair overlays
    setupCrosshairs() {
        // Create crosshair canvases
        const axialCanvas = document.createElement('canvas');
        const sagittalCanvas = document.createElement('canvas');
        
        axialCanvas.style.position = 'absolute';
        axialCanvas.style.top = '0';
        axialCanvas.style.left = '0';
        axialCanvas.style.pointerEvents = 'none';
        axialCanvas.style.zIndex = '10';
        
        sagittalCanvas.style.position = 'absolute';
        sagittalCanvas.style.top = '0';
        sagittalCanvas.style.left = '0';
        sagittalCanvas.style.pointerEvents = 'none';
        sagittalCanvas.style.zIndex = '10';
        
        this.axialElement.appendChild(axialCanvas);
        this.sagittalElement.appendChild(sagittalCanvas);
        
        this.axialCrosshairCanvas = axialCanvas;
        this.sagittalCrosshairCanvas = sagittalCanvas;

        console.log('✓ Crosshair canvases created');
    },

    // Update crosshair positions based on current slice indices
    updateCrosshairs() {
        if (!this.axialCrosshairCanvas || !this.sagittalCrosshairCanvas) return;

        // Axial crosshair (horizontal line showing sagittal position)
        const axialRect = this.axialElement.getBoundingClientRect();
        this.axialCrosshairCanvas.width = axialRect.width;
        this.axialCrosshairCanvas.height = axialRect.height;
        const axialCtx = this.axialCrosshairCanvas.getContext('2d');
        axialCtx.clearRect(0, 0, axialRect.width, axialRect.height);
        
        // Calculate crosshair position (normalized)
        const sagittalRatio = this.sagittalImageIds.length > 0 
            ? this.currentSagittalIndex / this.sagittalImageIds.length 
            : 0.5;
        const axialY = sagittalRatio * axialRect.height;
        
        axialCtx.strokeStyle = '#00ff00';
        axialCtx.lineWidth = 2;
        axialCtx.beginPath();
        axialCtx.moveTo(0, axialY);
        axialCtx.lineTo(axialRect.width, axialY);
        axialCtx.stroke();

        // Sagittal crosshair (vertical line showing axial position)
        const sagittalRect = this.sagittalElement.getBoundingClientRect();
        this.sagittalCrosshairCanvas.width = sagittalRect.width;
        this.sagittalCrosshairCanvas.height = sagittalRect.height;
        const sagittalCtx = this.sagittalCrosshairCanvas.getContext('2d');
        sagittalCtx.clearRect(0, 0, sagittalRect.width, sagittalRect.height);
        
        const axialRatio = this.axialImageIds.length > 0 
            ? this.currentAxialIndex / this.axialImageIds.length 
            : 0.5;
        const sagittalX = sagittalRect.width * (1 - axialRatio); // Inverted for typical sagittal orientation
        
        sagittalCtx.strokeStyle = '#00ff00';
        sagittalCtx.lineWidth = 2;
        sagittalCtx.beginPath();
        sagittalCtx.moveTo(sagittalX, 0);
        sagittalCtx.lineTo(sagittalX, sagittalRect.height);
        sagittalCtx.stroke();
    },

    // Keyboard controls for navigation
    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch(e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateAxial(-1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateAxial(1);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.navigateSagittal(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.navigateSagittal(1);
                    break;
                case 'r':
                case 'R':
                    e.preventDefault();
                    this.resetWindowing();
                    break;
            }
        });

        // Mouse wheel scrolling
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 1 : -1;
            this.navigateAxial(delta);
        });

        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 1 : -1;
            this.navigateSagittal(delta);
        });

        console.log('✓ Keyboard and mouse controls configured');
    },

    // Navigate axial series
    async navigateAxial(delta) {
        const newIndex = this.currentAxialIndex + delta;
        if (newIndex >= 0 && newIndex < this.axialImageIds.length) {
            await this.displayAxialImage(newIndex);
            this.updateSliceCounters();
        }
    },

    // Navigate sagittal series
    async navigateSagittal(delta) {
        const newIndex = this.currentSagittalIndex + delta;
        if (newIndex >= 0 && newIndex < this.sagittalImageIds.length) {
            await this.displaySagittalImage(newIndex);
            this.updateSliceCounters();
        }
    },

    // Reset windowing to defaults
    resetWindowing() {
        if (this.axialElement && cornerstone.getEnabledElement(this.axialElement)) {
            const viewport = cornerstone.getViewport(this.axialElement);
            viewport.voi.windowWidth = 400;
            viewport.voi.windowCenter = 40;
            viewport.scale = 1;
            viewport.translation = { x: 0, y: 0 };
            cornerstone.setViewport(this.axialElement, viewport);
        }

        if (this.sagittalElement && cornerstone.getEnabledElement(this.sagittalElement)) {
            const viewport = cornerstone.getViewport(this.sagittalElement);
            viewport.voi.windowWidth = 400;
            viewport.voi.windowCenter = 40;
            viewport.scale = 1;
            viewport.translation = { x: 0, y: 0 };
            cornerstone.setViewport(this.sagittalElement, viewport);
        }

        console.log('✓ Windowing reset to defaults');
    },

    // Update slice counter UI
    updateSliceCounters() {
        document.getElementById('axialSlice').textContent = this.currentAxialIndex + 1;
        document.getElementById('axialTotal').textContent = this.axialImageIds.length;
        document.getElementById('sagittalSlice').textContent = this.currentSagittalIndex + 1;
        document.getElementById('sagittalTotal').textContent = this.sagittalImageIds.length;
    },

    // Cleanup on study change
    reset() {
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;

        if (this.axialElement && cornerstone.getEnabledElement(this.axialElement)) {
            cornerstone.disable(this.axialElement);
        }
        if (this.sagittalElement && cornerstone.getEnabledElement(this.sagittalElement)) {
            cornerstone.disable(this.sagittalElement);
        }

        this.isInitialized = false;
        console.log('✓ Viewer reset');
    }
};

// =============================================================================
// STEP 3: Setup Window/Level Tool (Standard Cornerstone tool)
// =============================================================================
// Enable mouse drag for window/level adjustment
function enableWindowLevelTool() {
    [dicomViewer.axialElement, dicomViewer.sagittalElement].forEach(element => {
        let isDragging = false;
        let startX, startY;
        let startWindowWidth, startWindowCenter;

        element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only left click
            isDragging = true;
            startX = e.pageX;
            startY = e.pageY;
            
            const viewport = cornerstone.getViewport(element);
            startWindowWidth = viewport.voi.windowWidth;
            startWindowCenter = viewport.voi.windowCenter;
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaX = e.pageX - startX;
            const deltaY = e.pageY - startY;

            const viewport = cornerstone.getViewport(element);
            viewport.voi.windowWidth = Math.max(1, startWindowWidth + deltaX);
            viewport.voi.windowCenter = startWindowCenter + deltaY;
            
            cornerstone.setViewport(element, viewport);
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    });

    console.log('✓ Window/Level tool enabled');
}

// Initialize window/level tool after viewer is ready
setTimeout(() => {
    if (dicomViewer.isInitialized) {
        enableWindowLevelTool();
    }
}, 500);

console.log('✓ viewer_dual.js loaded successfully');
