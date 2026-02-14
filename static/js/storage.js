// Firebase Storage Handler
class StorageManager {
    constructor() {
        this.storage = firebase.storage();
        this.storageRef = this.storage.ref();
        this.cache = new Map(); // Cache for downloaded files
    }

    // Get download URL for a DICOM file
    async getDicomUrl(studyId, seriesId, filename) {
        const path = `dicoms/${studyId}/${seriesId}/${filename}`;
        
        // Check cache
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        try {
            const fileRef = this.storageRef.child(path);
            const url = await fileRef.getDownloadURL();
            this.cache.set(path, url);
            return url;
        } catch (error) {
            console.error(`Error getting URL for ${path}:`, error);
            throw error;
        }
    }

    // Download DICOM file as ArrayBuffer
    async downloadDicom(studyId, seriesId, filename) {
        try {
            const url = await this.getDicomUrl(studyId, seriesId, filename);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            return arrayBuffer;
        } catch (error) {
            console.error(`Error downloading ${filename}:`, error);
            throw error;
        }
    }

    // Download all DICOMs for a series (with progress callback)
    async downloadSeries(studyId, seriesId, filenames, onProgress) {
        const files = [];
        const total = filenames.length;
        
        for (let i = 0; i < filenames.length; i++) {
            const filename = filenames[i];
            
            try {
                const arrayBuffer = await this.downloadDicom(studyId, seriesId, filename);
                files.push({
                    filename: filename,
                    data: arrayBuffer
                });
                
                // Call progress callback
                if (onProgress) {
                    onProgress(i + 1, total);
                }
            } catch (error) {
                console.error(`Failed to download ${filename}:`, error);
                // Continue with other files
            }
        }
        
        return files;
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
    }
}

// Create global storage manager instance
const storageManager = new StorageManager();
