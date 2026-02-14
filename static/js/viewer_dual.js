// Dual-View DICOM Viewer - FIXED CROSSHAIR COORDINATES
class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        
        // Store DICOM metadata
        this.axialMetadata = [];
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

    async loadDualSeries(axialFiles, sagittalFiles) {
        console.log(`Loading dual series: ${axialFiles.length} axial, ${sagittalFiles.length} sagittal`);
        
        this.axialElement.style.display = 'block';
        this.axialElement.style.width = '100%';
        this.axialElement.style.height = '600px';
        
        this.sagittalElement.style.display = 'block';
        this.sagittalElement.style.width = '100%';
        this.sagittalElement.style.height = '600px';
        
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);
        
        console.log('✓ Both series loaded');
        
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

    updateCrosshairs() {
        this.drawCrosshairOnAxial();
        this.drawCrosshairOnSagittal();
    }

    // SIMPLIFIED: Just use the middle of the image since we're scrolling through stacks
    drawCrosshairOnAxial() {
        try {
            const canvas = this.axialElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            cornerstone.updateImage(this.axialElement);
            
            requestAnimationFrame(() => {
                // SIMPLIFIED: For now, just draw at center or use simple percentage
                // The sagittal stack goes left-right, so we map sagittal index to X position
                const totalSagittal = this.sagittalImageIds.length;
                const currentSagittal = this.currentSagittalIndex;
                
                if (totalSagittal > 0) {
                    // Map sagittal slice index to X position on axial canvas
                    // Middle sagittal = middle of axial canvas
                    const normalizedPosition = currentSagittal / (totalSagittal - 1);
                    const canvasX = normalizedPosition * canvas.width;
                    
                    console.log(`Axial crosshair: sagittal ${currentSagittal}/${totalSagittal} -> X=${canvasX.toFixed(0)}/${canvas.width}`);
                    
                    this.drawVerticalLine(context, canvas, canvasX);
                }
            });
            
        } catch (error) {
            console.error('Error drawing axial crosshair:', error);
        }
    }

    drawCrosshairOnSagittal() {
        try {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (!canvas) return;
            
            const context = canvas.getContext('2d');
            if (!context) return;
            
            cornerstone.updateImage(this.sagittalElement);
            
            requestAnimationFrame(() => {
                // SIMPLIFIED: For now, just use simple percentage
                // The axial stack goes superior-inferior (top-bottom), map to Y position
                const totalAxial = this.axialImageIds.length;
                const currentAxial = this.currentAxialIndex;
                
                if (totalAxial > 0) {
                    // Map axial slice index to Y position on sagittal canvas
                    // First axial (top of head) = top of sagittal
                    // Last axial (bottom) = bottom of sagittal
                    const normalizedPosition = currentAxial / (totalAxial - 1);
                    const canvasY = normalizedPosition * canvas.height;
                    
                    console.log(`Sagittal crosshair: axial ${currentAxial}/${totalAxial} -> Y=${canvasY.toFixed(0)}/${canvas.height}`);
                    
                    this.drawHorizontalLine(context, canvas, canvasY);
                }
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
