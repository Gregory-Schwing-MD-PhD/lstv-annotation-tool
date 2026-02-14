// Main Application Logic
class LSTVAnnotationApp {
    constructor() {
        this.currentStudy = null;
        this.currentSeries = null;
        this.studies = [];
        this.reviewedStudies = [];
    }

    // Initialize the application
    async init() {
        console.log('Initializing LSTV Annotation Tool...');
        
        try {
            // Show loading state
            this.showLoadingState('Authenticating...');
            
            // Initialize authentication (will redirect if not logged in)
            await authManager.init();
            console.log('✓ Authentication initialized');
            
            this.showLoadingState('Initializing DICOM viewer...');
            
            // Initialize DICOM viewer
            dicomViewer = new DicomViewer('dicomViewer');
            console.log('✓ DICOM viewer initialized');
            
            // Setup UI event listeners
            this.setupEventListeners();
            console.log('✓ Event listeners setup');
            
            this.showLoadingState('Loading studies...');
            
            // Load all studies from Firestore
            await this.loadStudies();
            console.log('✓ Studies loaded');
            
            // Load user's reviewed studies
            await this.loadUserProgress();
            console.log('✓ User progress loaded');
            
            // Update statistics dashboard
            await this.updateStats();
            console.log('✓ Statistics updated');
            
            this.showLoadingState('Loading first study...');
            
            // Load first available study
            await this.loadNextStudy();
            console.log('✓ First study loaded');
            
            console.log('🎉 Application initialized successfully!');
            
        } catch (error) {
            console.error('Initialization error:', error);
            this.showErrorState(`Error initializing application: ${error.message}<br><br>Please check:<br>1. You're logged in<br>2. DICOM files exist in Firebase Storage<br>3. Studies exist in Firestore`);
        }
    }

    // Show loading state
    showLoadingState(message) {
        const loadingDiv = document.getElementById('loadingMessage');
        if (loadingDiv) {
            loadingDiv.style.display = 'flex';
            const messageP = loadingDiv.querySelector('p');
            if (messageP) {
                messageP.textContent = message;
            }
        }
        
        const viewer = document.getElementById('dicomViewer');
        if (viewer) {
            viewer.classList.remove('active');
        }
    }

    // Show error state
    showErrorState(message) {
        const loadingDiv = document.getElementById('loadingMessage');
        if (loadingDiv) {
            loadingDiv.style.display = 'flex';
            loadingDiv.innerHTML = `
                <div style="text-align: center; color: #ef4444;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 1rem;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <p style="font-size: 1rem; font-weight: 600;">${message}</p>
                    <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 1rem;">Reload Page</button>
                </div>
            `;
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Sign out button
        const signOutBtn = document.getElementById('signOutBtn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', () => {
                authManager.signOut();
            });
        }

        // Annotation form submission
        const form = document.getElementById('annotationForm');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.submitAnnotation();
            });
        }

        // Skip study button
        const skipBtn = document.getElementById('skipStudy');
        if (skipBtn) {
            skipBtn.addEventListener('click', async () => {
                await this.skipStudy();
            });
        }

        // Window/level controls
        const wlControl = document.getElementById('windowLevel');
        const wwControl = document.getElementById('windowWidth');
        
        if (wlControl) {
            wlControl.addEventListener('input', (e) => {
                const wl = parseInt(e.target.value);
                const ww = parseInt(document.getElementById('windowWidth').value);
                if (dicomViewer) {
                    dicomViewer.setWindowLevel(wl, ww);
                }
            });
        }

        if (wwControl) {
            wwControl.addEventListener('input', (e) => {
                const wl = parseInt(document.getElementById('windowLevel').value);
                const ww = parseInt(e.target.value);
                if (dicomViewer) {
                    dicomViewer.setWindowLevel(wl, ww);
                }
            });
        }

        // Reset windowing button
        const resetBtn = document.getElementById('resetWindowing');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (dicomViewer) {
                    dicomViewer.resetWindowLevel();
                }
            });
        }
    }

    // Load all studies from Firestore
    async loadStudies() {
        try {
            const snapshot = await db.collection('studies').get();
            
            this.studies = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            console.log(`Loaded ${this.studies.length} studies from Firestore`);
            
            if (this.studies.length === 0) {
                throw new Error('No studies found in Firestore. Please add studies first.');
            }
            
        } catch (error) {
            console.error('Error loading studies:', error);
            throw error;
        }
    }

    // Load user's progress
    async loadUserProgress() {
        try {
            const userId = authManager.getUserId();
            this.reviewedStudies = await annotationsManager.getUserReviewedStudies(userId);
            
            console.log(`User has reviewed ${this.reviewedStudies.length} studies`);
            
        } catch (error) {
            console.error('Error loading user progress:', error);
            this.reviewedStudies = [];
        }
    }

    // Get next available study (not yet reviewed by user)
    getNextStudy() {
        // Filter out already reviewed studies
        const availableStudies = this.studies.filter(study => 
            !this.reviewedStudies.includes(study.study_id)
        );
        
        if (availableStudies.length === 0) {
            return null;
        }
        
        // Return first available study
        return availableStudies[0];
    }

    // Load next study
    async loadNextStudy() {
        try {
            const study = this.getNextStudy();
            
            if (!study) {
                this.showCompletionMessage();
                return;
            }
            
            this.currentStudy = study;
            
            // Select first series
            if (!study.series || study.series.length === 0) {
                throw new Error('Study has no series defined');
            }
            
            // Prefer T2 series, otherwise use first available
            const t2Series = study.series.find(s => 
                s.description && s.description.toLowerCase().includes('t2')
            );
            this.currentSeries = t2Series || study.series[0];
            
            console.log(`Loading study ${study.study_id}, series ${this.currentSeries.series_id}`);
            
            // Update UI
            document.getElementById('currentStudyId').textContent = study.study_id || 'Unknown';
            document.getElementById('currentSeriesInfo').textContent = 
                `${this.currentSeries.series_id || 'Unknown'} - ${this.currentSeries.description || 'No description'}`;
            
            // Show loading message
            this.showLoadingState('Loading DICOM files from Firebase Storage...');
            
            // Load DICOM files
            await this.loadDicomFiles(study.study_id, this.currentSeries);
            
            // Hide loading, show viewer
            document.getElementById('loadingMessage').style.display = 'none';
            document.getElementById('dicomViewer').classList.add('active');
            
            // Reset form
            const form = document.getElementById('annotationForm');
            if (form) {
                form.reset();
            }
            
        } catch (error) {
            console.error('Error loading study:', error);
            this.showErrorState(`Error loading study: ${error.message}`);
        }
    }

    // Load DICOM files for a series
    async loadDicomFiles(studyId, series) {
        try {
            console.log(`Loading series ${series.series_id} for study ${studyId}...`);
            
            // Check if we have a file list in the series
            if (series.files && Array.isArray(series.files)) {
                // Use the actual filenames from Firestore
                const filenames = series.files.map(f => f.filename);
                console.log(`Using ${filenames.length} filenames from Firestore metadata`);
                
                const files = await storageManager.downloadSeries(
                    studyId,
                    series.series_id,
                    filenames,
                    (current, total) => {
                        this.showLoadingState(`Loading DICOM files: ${current}/${total}`);
                    }
                );
                
                if (files.length === 0) {
                    throw new Error('No DICOM files downloaded. Check Firebase Storage.');
                }
                
                console.log(`Downloaded ${files.length} files, loading into viewer...`);
                
                if (dicomViewer) {
                    await dicomViewer.loadImages(files);
                    console.log(`✓ Loaded ${files.length} images into viewer`);
                } else {
                    throw new Error('DICOM viewer not initialized');
                }
                return;
            }
            
            // Fallback: Check if slice_count exists
            if (!series.slice_count || series.slice_count === 0) {
                throw new Error('Series has no slice_count or files list defined. Please check Firestore data.');
            }
            
            // Generate filenames - try both with and without zero padding
            const filenames = [];
            for (let i = 1; i <= series.slice_count; i++) {
                // Try without zero padding first (matches your actual files: 1.dcm, 2.dcm, etc.)
                filenames.push(i + '.dcm');
            }
            
            console.log(`Attempting to download ${filenames.length} DICOM files...`);
            
            // Download files from Firebase Storage
            const files = await storageManager.downloadSeries(
                studyId,
                series.series_id,
                filenames,
                (current, total) => {
                    // Update loading progress
                    this.showLoadingState(`Loading DICOM files: ${current}/${total}`);
                }
            );
            
            if (files.length === 0) {
                throw new Error('No DICOM files downloaded. Check that files exist in Firebase Storage at: dicoms/' + studyId + '/' + series.series_id + '/');
            }
            
            console.log(`Downloaded ${files.length} files, loading into viewer...`);
            
            // Load into viewer
            if (dicomViewer) {
                await dicomViewer.loadImages(files);
                console.log(`✓ Loaded ${files.length} images into viewer`);
            } else {
                throw new Error('DICOM viewer not initialized');
            }
            
        } catch (error) {
            console.error('Error loading DICOM files:', error);
            throw error;
        }
    }

    // Submit annotation
    async submitAnnotation() {
        try {
            const form = document.getElementById('annotationForm');
            const formData = new FormData(form);
            
            // Get form values
            const castellviType = formData.get('castellvi_type');
            const confidence = formData.get('confidence');
            const notes = formData.get('notes');
            
            if (!castellviType || !confidence) {
                alert('Please select a Castellvi type and confidence level.');
                return;
            }
            
            // Disable submit button
            const submitBtn = document.getElementById('submitAnnotation');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
            
            // Prepare annotation data
            const annotationData = {
                castellvi_type: castellviType,
                confidence: confidence,
                notes: notes,
                current_slice: dicomViewer ? dicomViewer.getCurrentSlice() : 0,
                total_slices: dicomViewer ? dicomViewer.getTotalSlices() : 0
            };
            
            // Submit to Firestore
            await annotationsManager.submitAnnotation(
                this.currentStudy.study_id,
                this.currentSeries.series_id,
                annotationData
            );
            
            // Add to reviewed studies
            this.reviewedStudies.push(this.currentStudy.study_id);
            
            // Update stats
            await this.updateStats();
            
            // Show success message
            this.showSuccessMessage();
            
            // Load next study after delay
            setTimeout(async () => {
                await this.loadNextStudy();
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Annotation';
            }, 1500);
            
        } catch (error) {
            console.error('Error submitting annotation:', error);
            alert('Error submitting annotation. Please try again.');
            
            // Re-enable submit button
            const submitBtn = document.getElementById('submitAnnotation');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Annotation';
        }
    }

    // Skip current study
    async skipStudy() {
        if (confirm('Skip this study? You can come back to it later.')) {
            // Move current study to end of list
            const skippedStudy = this.studies.shift();
            this.studies.push(skippedStudy);
            
            await this.loadNextStudy();
        }
    }

    // Update statistics dashboard
    async updateStats() {
        try {
            const stats = await annotationsManager.getAnnotationStats();
            
            document.getElementById('yourReviews').textContent = stats.yourReviews;
            document.getElementById('completedStudies').textContent = stats.completedStudies;
            document.getElementById('availableStudies').textContent = stats.availableStudies;
            document.getElementById('totalStudies').textContent = stats.totalStudies;
            
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    // Show completion message
    showCompletionMessage() {
        const loadingDiv = document.getElementById('loadingMessage');
        if (loadingDiv) {
            loadingDiv.style.display = 'flex';
            loadingDiv.innerHTML = `
                <div style="text-align: center; color: #10b981;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 1rem;">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <h2 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">All Studies Completed!</h2>
                    <p style="font-size: 1rem;">🎉 Congratulations! You have reviewed all available studies.<br>Thank you for your contributions!</p>
                </div>
            `;
        }
        
        // Clear viewer
        if (dicomViewer) {
            dicomViewer.clear();
        }
        
        // Hide viewer
        const viewer = document.getElementById('dicomViewer');
        if (viewer) {
            viewer.classList.remove('active');
        }
    }

    // Show success message
    showSuccessMessage() {
        // Create temporary success message
        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: #10b981;
            color: white;
            padding: 1.5rem 3rem;
            border-radius: 8px;
            font-size: 1.125rem;
            font-weight: 600;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            z-index: 9999;
            animation: fadeIn 0.3s ease-in-out;
        `;
        message.textContent = '✓ Annotation submitted successfully!';
        
        document.body.appendChild(message);
        
        setTimeout(() => {
            message.style.animation = 'fadeOut 0.3s ease-in-out';
            setTimeout(() => message.remove(), 300);
        }, 1700);
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new LSTVAnnotationApp();
    app.init();
});
