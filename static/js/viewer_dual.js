// Dual-View DICOM Viewer - ACTUAL KAGGLE-STYLE COORDINATE MAPPING
class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        // Store actual Z and X positions from DICOM
        this.axialZPositions = [];   // Z-coordinate for each axial slice
        this.sagittalXPositions = []; // X-coordinate for each sagittal slice
        
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

    // Extract Z or X position from DICOM ImagePositionPatient
    async extractPosition(imageId, axis) {
        try {
            const image = await cornerstone.loadImage(imageId);
            
            // Try multiple ways to get ImagePositionPatient
            let position = null;
            
            if (image.data && image.data.string) {
                const ipp = image.data.string('x00200032');
                if (ipp) {
                    const pos = ipp.split('\\').map(parseFloat);
                    if (pos.length === 3) {
                        position = pos;
                    }
                }
            }
            
            if (!position && image.imagePositionPatient) {
                position = image.imagePositionPatient;
            }
            
            if (position) {
                // axis 0 = X, axis 2 = Z
                return position[axis];
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting position:', error);
            return null;
        }
    }

    // TRULY PARALLEL LOADING using Promise.all on INDIVIDUAL files
    async loadDualSeries(axialFiles, sagittalFiles) {
        console.log(`Loading dual series: ${axialFiles.length} axial, ${sagittalFiles.length} sagittal`);
        
        this.axialElement.style.display = 'block';
        this.axialElement.style.width = '100%';
        this.axialElement.style.height = '600px';
        
        this.sagittalElement.style.display = 'block';
        this.sagittalElement.style.width = '100%';
        this.sagittalElement.style.height = '600px';
        
        // Load BOTH series in TRULY parallel fashion
        const [axialResult, sagittalResult] = await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        console.log('✓ Both series loaded in parallel');
        console.log(`Axial Z range: ${Math.min(...this.axialZPositions).toFixed(1)} to ${Math.max(...this.axialZPositions).toFixed(1)} mm`);
        console.log(`Sagittal X range: ${Math.min(...this.sagittalXPositions).toFixed(1)} to ${Math.max(...this.sagittalXPositions).toFixed(1)} mm`);
        
        const axialStart = Math.floor(this.axialImageIds.length / 2);
        const sagittalStart = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(axialStart),
            this.displaySagittalImage(sagittalStart)
        ]);
        
        setTimeout(() => {
            try {
                cornerstone.resize(this.axialElement, true);
                cornerstone.updateImage(this.axialElement);
                console.log('✓ Axial resized');
            } catch (e) {}
            
            try {
                cornerstone.resize(this.sagittalElement, true);
                cornerstone.updateImage(this.sagittalElement);
                console.log('✓ Sagittal resized');
            } catch (e) {}
            
            this.updateCrosshairs();
        }, 150);
        
        this.updateSliceInfo();
    }

    async loadAxialSeries(axialFiles) {
        if (!axialFiles || axialFiles.length === 0) return;
        
        console.log('Loading axial series in parallel...');
        
        // Load ALL files in parallel using Promise.all
        const loadPromises = axialFiles.map(async (file) => {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                
                // Extract Z position immediately
                const zPos = await this.extractPosition(imageId, 2); // axis 2 = Z
                
                return {
                    id: imageId,
                    filename: file.filename,
                    zPosition: zPos
                };
            } catch (error) {
                console.error(`Error loading axial ${file.filename}:`, error);
                return null;
            }
        });
        
        // Wait for ALL files to load in parallel
        const results = await Promise.all(loadPromises);
        
        // Filter out failures and sort by filename
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        // Store imageIds and Z positions
        this.axialImageIds = validResults.map(r => ({ id: r.id, filename: r.filename }));
        this.axialZPositions = validResults.map(r => r.zPosition || 0);
        
        console.log(`✓ Loaded ${this.axialImageIds.length} axial images in parallel`);
    }

    async loadSagittalSeries(sagittalFiles) {
        if (!sagittalFiles || sagittalFiles.length === 0) return;
        
        console.log('Loading sagittal series in parallel...');
        
        // Load ALL files in parallel using Promise.all
        const loadPromises = sagittalFiles.map(async (file) => {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                
                // Extract X position immediately
                const xPos = await this.extractPosition(imageId, 0); // axis 0 = X
                
                return {
                    id: imageId,
                    filename: file.filename,
                    xPosition: xPos
                };
            } catch (error) {
                console.error(`Error loading sagittal ${file.filename}:`, error);
                return null;
            }
        });
        
        // Wait for ALL files to load in parallel
        const results = await Promise.all(loadPromises);
        
        // Filter out failures and sort by filename
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        // Store imageIds and X positions
        this.sagittalImageIds = validResults.map(r => ({ id: r.id, filename: r.filename }));
        this.sagittalXPositions = validResults.map(r => r.xPosition || 0);
        
        console.log(`✓ Loaded ${this.sagittalImageIds.length} sagittal images in parallel`);
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
            console.error('Error displaying sagittal image:', error);
        }
    }

    updateCrosshairs() {
        this.drawCrosshairOnAxial();
        this.drawCrosshairOnSagittal();
    }

    // Draw vertical line on AXIAL showing current SAGITTAL X-position
    drawCrosshairOnAxial() {
        try {
            const canvas = this.axialElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            cornerstone.updateImage(this.axialElement);
            
            requestAnimationFrame(() => {
                // Get current sagittal X position (world coordinates)
                const currentSagX = this.sagittalXPositions[this.currentSagittalIndex];
                
                // Get axial X range (from all axial slices - they share the same X extent)
                const minAxialX = Math.min(...this.sagittalXPositions);
                const maxAxialX = Math.max(...this.sagittalXPositions);
                const axialXRange = maxAxialX - minAxialX;
                
                if (axialXRange > 0 && currentSagX !== null) {
                    // Map sagittal X position to axial canvas X
                    const normalizedX = (currentSagX - minAxialX) / axialXRange;
                    const canvasX = normalizedX * canvas.width;
                    
                    console.log(`Axial crosshair: sag X=${currentSagX.toFixed(1)}mm -> canvas X=${canvasX.toFixed(0)}/${canvas.width}`);
                    
                    this.drawVerticalLine(context, canvas, canvasX);
                } else {
                    // Fallback to simple percentage
                    const normalizedX = this.currentSagittalIndex / Math.max(1, this.sagittalImageIds.length - 1);
                    const canvasX = normalizedX * canvas.width;
                    this.drawVerticalLine(context, canvas, canvasX);
                }
            });
        } catch (error) {
            console.error('Error drawing axial crosshair:', error);
        }
    }

    // Draw horizontal line on SAGITTAL showing current AXIAL Z-position
    drawCrosshairOnSagittal() {
        try {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            cornerstone.updateImage(this.sagittalElement);
            
            requestAnimationFrame(() => {
                // Get current axial Z position (world coordinates)
                const currentAxZ = this.axialZPositions[this.currentAxialIndex];
                
                // Get sagittal Z range (from all axial slices - sagittal sees the same Z extent)
                const minSagZ = Math.min(...this.axialZPositions);
                const maxSagZ = Math.max(...this.axialZPositions);
                const sagZRange = maxSagZ - minSagZ;
                
                if (sagZRange > 0 && currentAxZ !== null) {
                    // Map axial Z position to sagittal canvas Y
                    // Note: Z typically DECREASES from top to bottom
                    const normalizedZ = (maxSagZ - currentAxZ) / sagZRange;
                    const canvasY = normalizedZ * canvas.height;
                    
                    console.log(`Sagittal crosshair: ax Z=${currentAxZ.toFixed(1)}mm -> canvas Y=${canvasY.toFixed(0)}/${canvas.height}`);
                    
                    this.drawHorizontalLine(context, canvas, canvasY);
                } else {
                    // Fallback to simple percentage
                    const normalizedZ = this.currentAxialIndex / Math.max(1, this.axialImageIds.length - 1);
                    const canvasY = normalizedZ * canvas.height;
                    this.drawHorizontalLine(context, canvas, canvasY);
                }
            });
        } catch (error) {
            console.error('Error drawing sagittal crosshair:', error);
        }
    }

    drawVerticalLine(context, canvas, x) {
        // Clamp to canvas bounds
        x = Math.max(0, Math.min(canvas.width, x));
        
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
        // Clamp to canvas bounds
        y = Math.max(0, Math.min(canvas.height, y));
        
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
        document.getElementById('axialSlice').textContent = this.currentAxialIndex + 1;
        document.getElementById('axialTotal').textContent = this.axialImageIds.length;
        document.getElementById('sagittalSlice').textContent = this.currentSagittalIndex + 1;
        document.getElementById('sagittalTotal').textContent = this.sagittalImageIds.length;
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
        this.axialZPositions = [];
        this.sagittalXPositions = [];
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
