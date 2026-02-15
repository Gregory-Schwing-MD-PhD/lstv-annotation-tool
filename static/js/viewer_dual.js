/**
 * Dual-View DICOM Viewer - NATIVE RESOLUTION VERSION
 * Renders images at 1:1 pixel ratio - no scaling issues
 */

class DualDicomViewer {
    constructor(axialElementId, sagittalElementId) {
        this.axialElement = document.getElementById(axialElementId);
        this.sagittalElement = document.getElementById(sagittalElementId);
        
        this.axialImageIds = [];
        this.sagittalImageIds = [];
        this.axialMetadata = [];   
        this.sagittalMetadata = [];
        
        this.currentAxialIndex = 0;
        this.currentSagittalIndex = 0;
        this.isInitialized = false;
        
        if (!this.axialElement || !this.sagittalElement) {
            console.error('❌ Viewer elements not found!');
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
            
            // Enable Cornerstone
            cornerstone.enable(this.axialElement);
            cornerstone.enable(this.sagittalElement);
            
            // Remove fixed dimensions - let images dictate size
            this.axialElement.style.position = 'relative';
            this.sagittalElement.style.position = 'relative';
            
            this.isInitialized = true;
            this.setupEventListeners();
            
            console.log('✓ Dual DICOM Viewer initialized (Native Resolution Mode)');
        } catch (error) {
            console.error('❌ Error initializing dual viewer:', error);
        }
    }

    resize() {
        console.log('⚡ Resize triggered (no-op in native mode)');
        // In native resolution mode, we don't resize images
        // Just trigger a redraw
        if (this.axialImageIds.length) {
            cornerstone.updateImage(this.axialElement);
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    setupEventListeners() {
        this.axialElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.deltaY < 0 ? this.previousAxialImage() : this.nextAxialImage();
        });

        this.sagittalElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.deltaY < 0 ? this.previousSagittalImage() : this.nextSagittalImage();
        });

        this.axialElement.addEventListener('cornerstoneimagerendered', () => {
            const canvas = this.axialElement.querySelector('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                this.drawCrosshairOnAxial(ctx);
            }
        });

        this.sagittalElement.addEventListener('cornerstoneimagerendered', () => {
            const canvas = this.sagittalElement.querySelector('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                this.drawCrosshairOnSagittal(ctx);
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (this.axialImageIds.length === 0) return;
            if (e.key === 'ArrowUp') this.previousAxialImage();
            else if (e.key === 'ArrowDown') this.nextAxialImage();
            else if (e.key === 'ArrowLeft') this.previousSagittalImage();
            else if (e.key === 'ArrowRight') this.nextSagittalImage();
        });

        this.setupWindowLevel(this.axialElement);
        this.setupWindowLevel(this.sagittalElement);
    }

    setupWindowLevel(element) {
        let startX, startY, startWL, startWW;
        let isDragging = false;

        element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            try {
                const vp = cornerstone.getViewport(element);
                startWL = vp.voi.windowCenter;
                startWW = vp.voi.windowWidth;
            } catch (e) {}
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            try {
                const vp = cornerstone.getViewport(element);
                vp.voi.windowCenter = startWL + deltaY;
                vp.voi.windowWidth = Math.max(1, startWW + deltaX);
                cornerstone.setViewport(element, vp);
            } catch (e) {}
        });
        document.addEventListener('mouseup', () => isDragging = false);
    }

    projectPointToSlice(worldPoint, sliceMetadata) {
        if (!sliceMetadata || !sliceMetadata.position || !sliceMetadata.spacing) return null;
        
        const [px, py, pz] = worldPoint;
        const [sx, sy, sz] = sliceMetadata.position;
        const [rowX, rowY, rowZ, colX, colY, colZ] = sliceMetadata.orientation;
        const [rowSpacing, colSpacing] = sliceMetadata.spacing;

        const dx = px - sx;
        const dy = py - sy;
        const dz = pz - sz;

        const mmX = dx * rowX + dy * rowY + dz * rowZ;
        const mmY = dx * colX + dy * colY + dz * colZ;

        // Return pixel coordinates (column, row)
        return { x: mmX / colSpacing, y: mmY / rowSpacing };
    }

    async loadDualSeries(axialFiles, sagittalFiles) {
        this.clear();
        console.log(`📥 Loading: ${axialFiles.length} Ax, ${sagittalFiles.length} Sag`);
        
        await Promise.all([
            this.loadAxialSeries(axialFiles),
            this.loadSagittalSeries(sagittalFiles)
        ]);

        console.log(`✓ Metadata loaded`);

        const midAx = Math.floor(this.axialImageIds.length / 2);
        const midSag = Math.floor(this.sagittalImageIds.length / 2);
        
        await Promise.all([
            this.displayAxialImage(midAx),
            this.displaySagittalImage(midSag)
        ]);
        
        console.log(`✓ Images displayed at native resolution`);
        
        this.updateSliceInfo();
    }

    async loadAxialSeries(files) {
        const results = await this.processFiles(files);
        results.sort((a, b) => b.metadata.position[2] - a.metadata.position[2]);
        this.axialImageIds = results.map(r => ({ id: r.id }));
        this.axialMetadata = results.map(r => r.metadata);
    }

    async loadSagittalSeries(files) {
        const results = await this.processFiles(files);
        results.sort((a, b) => a.metadata.position[0] - b.metadata.position[0]);
        this.sagittalImageIds = results.map(r => ({ id: r.id }));
        this.sagittalMetadata = results.map(r => r.metadata);
    }

    async processFiles(files) {
        const promises = files.map(async (file) => {
            try {
                const blob = new Blob([file.data], { type: 'application/dicom' });
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(blob);
                const metadata = await this.extractDicomMetadata(imageId);
                return { id: imageId, filename: file.filename, metadata };
            } catch (e) { return null; }
        });
        return (await Promise.all(promises)).filter(x => x !== null);
    }

    async extractDicomMetadata(imageId) {
        try {
            const image = await cornerstone.loadImage(imageId);
            let meta = {
                position: image.imagePositionPatient,
                orientation: null,
                spacing: [image.rowPixelSpacing, image.columnPixelSpacing],
                rows: image.rows,
                columns: image.columns
            };
            if (image.rowCosines) meta.orientation = [...image.rowCosines, ...image.columnCosines];
            
            if ((!meta.position || !meta.orientation) && image.data && image.data.string) {
                const ipp = image.data.string('x00200032');
                const iop = image.data.string('x00200037');
                if (ipp) meta.position = ipp.split('\\').map(parseFloat);
                if (iop) meta.orientation = iop.split('\\').map(parseFloat);
            }
            return meta;
        } catch (e) {
            return { position: [0,0,0], orientation: [1,0,0,0,1,0], spacing: [1,1] };
        }
    }

    async displayAxialImage(index) {
        if (index < 0 || index >= this.axialImageIds.length) return;
        
        this.currentAxialIndex = index;
        
        try {
            const image = await cornerstone.loadAndCacheImage(this.axialImageIds[index].id);
            
            // Set viewport to native resolution (scale = 1.0)
            const viewport = cornerstone.getDefaultViewportForImage(this.axialElement, image);
            viewport.scale = 1.0; // Native 1:1 pixel ratio
            viewport.translation = { x: 0, y: 0 };
            
            cornerstone.displayImage(this.axialElement, image, viewport);
            
            // Resize element to match image
            this.axialElement.style.width = image.width + 'px';
            this.axialElement.style.height = image.height + 'px';
            
            console.log(`✓ Axial ${index + 1}: ${image.width}x${image.height} at 1:1`);
        } catch (error) {
            console.error('❌ Error displaying axial:', error);
        }
    }

    async displaySagittalImage(index) {
        if (index < 0 || index >= this.sagittalImageIds.length) return;
        
        this.currentSagittalIndex = index;
        
        try {
            const image = await cornerstone.loadAndCacheImage(this.sagittalImageIds[index].id);
            
            // Set viewport to native resolution (scale = 1.0)
            const viewport = cornerstone.getDefaultViewportForImage(this.sagittalElement, image);
            viewport.scale = 1.0; // Native 1:1 pixel ratio
            viewport.translation = { x: 0, y: 0 };
            
            cornerstone.displayImage(this.sagittalElement, image, viewport);
            
            // Resize element to match image
            this.sagittalElement.style.width = image.width + 'px';
            this.sagittalElement.style.height = image.height + 'px';
            
            console.log(`✓ Sagittal ${index + 1}: ${image.width}x${image.height} at 1:1`);
        } catch (error) {
            console.error('❌ Error displaying sagittal:', error);
        }
    }

    drawCrosshairOnAxial(ctx) {
        if (!this.sagittalMetadata.length) return;
        
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        
        const proj = this.projectPointToSlice(sagMeta.position, axMeta);
        
        if (proj) {
            // At 1:1 scale, pixel coords = canvas coords
            const pixelX = proj.x;
            const pixelY = proj.y;
            
            const width = axMeta.columns;
            const height = axMeta.rows;
            
            // Draw vertical line if X is in bounds
            if (pixelX >= 0 && pixelX <= width) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.moveTo(pixelX, 0);
                ctx.lineTo(pixelX, height);
                ctx.stroke();
                ctx.restore();
                
                console.log(`✓ Axial crosshair at X=${pixelX.toFixed(1)}`);
            }
        }
    }

    drawCrosshairOnSagittal(ctx) {
        if (!this.axialMetadata.length) return;
        
        const axMeta = this.axialMetadata[this.currentAxialIndex];
        const sagMeta = this.sagittalMetadata[this.currentSagittalIndex];
        
        const proj = this.projectPointToSlice(axMeta.position, sagMeta);
        
        if (proj) {
            // At 1:1 scale, pixel coords = canvas coords
            const pixelX = proj.x;
            const pixelY = proj.y;
            
            const width = sagMeta.columns;
            const height = sagMeta.rows;
            
            // Draw horizontal line if Y is in bounds
            if (pixelY >= 0 && pixelY <= height) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.moveTo(0, pixelY);
                ctx.lineTo(width, pixelY);
                ctx.stroke();
                ctx.restore();
                
                console.log(`✓ Sagittal crosshair at Y=${pixelY.toFixed(1)}`);
            }
        }
    }

    async nextAxialImage() {
        if (this.currentAxialIndex < this.axialImageIds.length - 1) {
            await this.displayAxialImage(this.currentAxialIndex + 1);
            this.updateSliceInfo();
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    async previousAxialImage() {
        if (this.currentAxialIndex > 0) {
            await this.displayAxialImage(this.currentAxialIndex - 1);
            this.updateSliceInfo();
            cornerstone.updateImage(this.sagittalElement);
        }
    }

    async nextSagittalImage() {
        if (this.currentSagittalIndex < this.sagittalImageIds.length - 1) {
            await this.displaySagittalImage(this.currentSagittalIndex + 1);
            this.updateSliceInfo();
            cornerstone.updateImage(this.axialElement);
        }
    }

    async previousSagittalImage() {
        if (this.currentSagittalIndex > 0) {
            await this.displaySagittalImage(this.currentSagittalIndex - 1);
            this.updateSliceInfo();
            cornerstone.updateImage(this.axialElement);
        }
    }

    updateSliceInfo() {
        try {
            document.getElementById('axialSlice').textContent = this.currentAxialIndex + 1;
            document.getElementById('axialTotal').textContent = this.axialImageIds.length;
            document.getElementById('sagittalSlice').textContent = this.currentSagittalIndex + 1;
            document.getElementById('sagittalTotal').textContent = this.sagittalImageIds.length;
        } catch(e) {}
    }

    resetWindowLevel() {
        try {
            cornerstone.reset(this.axialElement);
            cornerstone.reset(this.sagittalElement);
            
            // Re-apply native resolution after reset
            if (this.axialImageIds.length) {
                this.displayAxialImage(this.currentAxialIndex);
                this.displaySagittalImage(this.currentSagittalIndex);
            }
        } catch(e) {}
    }
    
    getCurrentSlices() {
        return { axial: this.currentAxialIndex + 1, sagittal: this.currentSagittalIndex + 1 };
    }

    clear() {
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
}
let dicomViewer = null;
