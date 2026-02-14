// Dual-View DICOM Viewer - GEOMETRIC CENTER + SCALED RANGES
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

    getImageBounds(element) {
        try {
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) {
                return null;
            }
            
            const image = enabledElement.image;
            const viewport = enabledElement.viewport;
            const canvas = enabledElement.canvas;
            
            const imageWidth = image.width;
            const imageHeight = image.height;
            
            const scale = viewport.scale || 1;
            const renderedWidth = imageWidth * scale;
            const renderedHeight = imageHeight * scale;
            
            const translation = viewport.translation || { x: 0, y: 0 };
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            
            const left = (canvasWidth / 2) - (renderedWidth / 2) + translation.x;
            const top = (canvasHeight / 2) - (renderedHeight / 2) + translation.y;
            const right = left + renderedWidth;
            const bottom = top + renderedHeight;
            
            return {
                left: left,
                top: top,
                right: right,
                bottom: bottom,
                width: renderedWidth,
                height: renderedHeight,
                centerX: left + renderedWidth / 2,
                centerY: top + renderedHeight / 2
            };
        } catch (error) {
            console.error('Error getting image bounds:', error);
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
        
        this.showLoading(this.axialElement, 'Loading axial series...');
        this.showLoading(this.sagittalElement, 'Loading sagittal series...');
        
        const startTime = Date.now();
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        const loadTime = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`✓ Both series loaded in ${loadTime}s (parallel)`);
        
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
                cornerstone.updateImage(this.axialElement);
            } catch (e) {}
            
            try {
                cornerstone.resize(this.sagittalElement, true);
                cornerstone.updateImage(this.sagittalElement);
            } catch (e) {}
            
            this.updateCrosshairs();
        }, 150);
        
        this.updateSliceInfo();
    }

    showLoading(element, message) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading-overlay';
        loadingDiv.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            z-index: 1000;
        `;
        
        loadingDiv.innerHTML = `
            <div style="width: 40px; height: 40px; border: 4px solid #444; border-top: 4px solid #2563eb; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem;"></div>
            <p>${message}</p>
        `;
        
        element.parentElement.style.position = 'relative';
        element.parentElement.appendChild(loadingDiv);
    }

    hideLoading(element) {
        const loadingDiv = element.parentElement.querySelector('.loading-overlay');
        if (loadingDiv) {
            loadingDiv.remove();
        }
    }

    async loadAxialSeries(axialFiles) {
        if (!axialFiles || axialFiles.length === 0) return;
        
        this.axialImageIds = [];
        
        const results = await Promise.all(
            axialFiles.map(async (file) => {
                try {
                    const blob = new Blob([file.data], { type: 'application/dicom' });
                    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                    return { id: imageId, filename: file.filename };
                } catch (error) {
                    console.error(`Error loading axial ${file.filename}:`, error);
                    return null;
                }
            })
        );
        
        this.axialImageIds = results
            .filter(r => r !== null)
            .sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
        console.log(`✓ Loaded ${this.axialImageIds.length} axial images`);
    }

    async loadSagittalSeries(sagittalFiles) {
        if (!sagittalFiles || sagittalFiles.length === 0) return;
        
        this.sagittalImageIds = [];
        
        const results = await Promise.all(
            sagittalFiles.map(async (file) => {
                try {
                    const blob = new Blob([file.data], { type: 'application/dicom' });
                    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                    return { id: imageId, filename: file.filename };
                } catch (error) {
                    console.error(`Error loading sagittal ${file.filename}:`, error);
                    return null;
                }
            })
        );
        
        this.sagittalImageIds = results
            .filter(r => r !== null)
            .sort((a, b) => a.filename.localeCompare(b.filename, undefined, {numeric: true}));
        
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

    // Vertical line on AXIAL - centered at midline, scaled by sagittal slice count
    drawCrosshairOnAxial() {
        try {
            const canvas = this.axialElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            cornerstone.updateImage(this.axialElement);
            
            requestAnimationFrame(() => {
                const bounds = this.getImageBounds(this.axialElement);
                if (!bounds) return;
                
                const totalSagittal = this.sagittalImageIds.length;
                const currentSagittal = this.currentSagittalIndex;
                const middleSagittal = Math.floor(totalSagittal / 2);
                
                // Calculate offset from middle sagittal slice
                const offsetFromMiddle = currentSagittal - middleSagittal;
                
                // Scale the range to use 80% of image width
                const rangeWidth = bounds.width * 0.8;
                const pixelsPerSlice = rangeWidth / Math.max(1, totalSagittal - 1);
                
                // Start at geometric center, add offset
                const x = bounds.centerX + (offsetFromMiddle * pixelsPerSlice);
                
                console.log(`Axial: sag ${currentSagittal}/${totalSagittal}, offset=${offsetFromMiddle}, X=${x.toFixed(0)}, center=${bounds.centerX.toFixed(0)}, range=${rangeWidth.toFixed(0)}`);
                
                this.drawVerticalLine(context, x, bounds.top, bounds.bottom);
            });
        } catch (error) {
            console.error('Error drawing axial crosshair:', error);
        }
    }

    // Horizontal line on SAGITTAL - centered at midline, scaled by axial slice count
    drawCrosshairOnSagittal() {
        try {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            cornerstone.updateImage(this.sagittalElement);
            
            requestAnimationFrame(() => {
                const bounds = this.getImageBounds(this.sagittalElement);
                if (!bounds) return;
                
                const totalAxial = this.axialImageIds.length;
                const currentAxial = this.currentAxialIndex;
                const middleAxial = Math.floor(totalAxial / 2);
                
                // Calculate offset from middle axial slice
                const offsetFromMiddle = currentAxial - middleAxial;
                
                // Scale the range to use 80% of image height
                const rangeHeight = bounds.height * 0.8;
                const pixelsPerSlice = rangeHeight / Math.max(1, totalAxial - 1);
                
                // Start at geometric center, add offset
                const y = bounds.centerY + (offsetFromMiddle * pixelsPerSlice);
                
                console.log(`Sagittal: ax ${currentAxial}/${totalAxial}, offset=${offsetFromMiddle}, Y=${y.toFixed(0)}, center=${bounds.centerY.toFixed(0)}, range=${rangeHeight.toFixed(0)}`);
                
                this.drawHorizontalLine(context, y, bounds.left, bounds.right);
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
