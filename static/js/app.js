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
            // Initialize authentication
            await authManager.init();
            console.log('✓ Authentication initialized');
            
            // Initialize DICOM viewer
            dicomViewer = new DicomViewer('dicomViewer');
            console.log('✓ DICOM viewer initialized');
            
            // Setup UI event listeners
            this.setupEventListeners();
            console.log('✓ Event listeners setup');
            
            // Load all studies from Firestore
            await this.loadStudies();
            console.log('✓ Studies loaded');
            
            // Load user's reviewed studies
            await this.loadUserProgress();
            console.log('✓ User progress loaded');
            
            // Update statistics dashboard
            await this.updateStats();
            console.log('✓ Statistics updated');
            
            // Load first available study
            await this.loadNextStudy();
            console.log('✓ First study loaded');
            
            console.log('🎉 Application initialized successfully!');
            
        } catch (error) {
            console.error('Initialization error:', error);
            alert('Error initializing application. Please refresh the page.');
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Sign out button
        document.getElementById('signOutBtn').addEventListener('click', () => {
            authManager.signOut();
        });

        // Annotation form submission
        document.getElementById('annotationForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.submitAnnotation();
        });

        // Skip study button
        document.getElementById('skipStudy').addEventListener('click', async () => {
            await this.skipStudy();
        });

        // Window/level controls
        document.getElementById('windowLevel').addEventListener('input', (e) => {
            const wl = parseInt(e.target.value);
            const ww = parseInt(document.getElementById('windowWidth').value);
            dicomViewer.setWindowLevel(wl, ww);
        });

        document.getElementById('windowWidth').addEventListener('input', (e) => {
            const wl = parseInt(document.getElementById('windowLevel').value);
            const ww = parseInt(e.target.value);
            dicomViewer.setWindowLevel(wl, ww);
        });

        // Reset windowing button
        document.getElementById('resetWindowing').addEventListener('click', () => {
            dicomViewer.resetWindowLevel();
        });
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
            
            // Select first T2 series (or first series if no T2)
            const t2Series = study.series.find(s => 
                s.description.toLowerCase().includes('t2')
            );
            this.currentSeries = t2Series || study.series[0];
            
            // Update UI
            document.getElementById('currentStudyId').textContent = study.study_id;
            document.getElementById('currentSeriesInfo').textContent = 
                `${this.currentSeries.series_id} - ${this.currentSeries.description}`;
            
            // Show loading message
            document.getElementById('loadingMessage').style.display = 'flex';
            document.getElementById('dicomViewer').classList.remove('active');
            
            // Load DICOM files
            await this.loadDicomFiles(study.study_id, this.currentSeries);
            
            // Hide loading, show viewer
            document.getElementById('loadingMessage').style.display = 'none';
            document.getElementById('dicomViewer').classList.add('active');
            
            // Reset form
            document.getElementById('annotationForm').reset();
            
        } catch (error) {
            console.error('Error loading study:', error);
            alert('Error loading study. Please try again.');
        }
    }

    // Load DICOM files for a series
    async loadDicomFiles(studyId, series) {
        try {
            console.log(`Loading series ${series.series_id} for study ${studyId}...`);
            
            // Generate filenames (assuming sequential: 001.dcm, 002.dcm, etc.)
            const filenames = [];
            for (let i = 1; i <= series.slice_count; i++) {
                const filename = String(i).padStart(3, '0') + '.dcm';
                filenames.push(filename);
            }
            
            // Download files from Firebase Storage
            const files = await storageManager.downloadSeries(
                studyId,
                series.series_id,
                filenames,
                (current, total) => {
                    // Update loading progress
                    const loadingMsg = document.querySelector('.loading-message p');
                    if (loadingMsg) {
                        loadingMsg.textContent = `Loading DICOM files: ${current}/${total}`;
                    }
                }
            );
            
            // Load into viewer
            await dicomViewer.loadImages(files);
            
            console.log(`✓ Loaded ${files.length} images`);
            
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
                current_slice: dicomViewer.getCurrentSlice(),
                total_slices: dicomViewer.getTotalSlices()
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
        alert('🎉 Congratulations! You have reviewed all available studies. Thank you for your contributions!');
        
        // Clear viewer
        dicomViewer.clear();
        
        // Hide viewer, show message
        document.getElementById('dicomViewer').style.display = 'none';
        document.getElementById('loadingMessage').style.display = 'flex';
        document.querySelector('.loading-message p').textContent = 
            '✓ All studies completed! Thank you for your contributions.';
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
        `;
        message.textContent = '✓ Annotation submitted successfully!';
        
        document.body.appendChild(message);
        
        setTimeout(() => {
            message.remove();
        }, 2000);
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new LSTVAnnotationApp();
    app.init();
});
