// Main Application for Dual-View LSTV Annotation
class LSTVDualAnnotationApp {
    constructor() {
        this.currentUser = null;
        this.studies = [];
        this.currentStudyIndex = 0;
        this.userProgress = {};
    }

    async init() {
        try {
            console.log('Initializing LSTV Dual Annotation Tool...');
            
            // Initialize authentication
            await authManager.init();
            this.currentUser = authManager.getCurrentUser();
            
            if (!this.currentUser) {
                window.location.href = 'login.html';
                return;
            }
            
            document.getElementById('userName').textContent = this.currentUser.email;
            console.log('✓ Authentication initialized');
            
            // Initialize dual viewer
            dicomViewer = new DualDicomViewer('axialViewer', 'sagittalViewer');
            console.log('✓ Dual DICOM viewer initialized');
            
            // Setup event listeners
            this.setupEventListeners();
            console.log('✓ Event listeners setup');
            
            // Load studies from Firestore
            await this.loadStudies();
            console.log('✓ Studies loaded');
            
            // Load user progress
            await this.loadUserProgress();
            console.log('✓ User progress loaded');
            
            // Update statistics
            this.updateStatistics();
            console.log('✓ Statistics updated');
            
            // Load first study
            await this.loadNextStudy();
            console.log('✓ First study loaded');
            
            console.log('🎉 Application initialized successfully!');
        } catch (error) {
            console.error('Error initializing app:', error);
            alert('Error initializing application. Please refresh the page.');
        }
    }

    setupEventListeners() {
        // Sign out
        document.getElementById('signOutBtn').addEventListener('click', async () => {
            await authManager.signOut();
            window.location.href = 'login.html';
        });

        // Submit annotation
        document.getElementById('annotationForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.submitAnnotation();
        });

        // Skip study
        document.getElementById('skipStudy').addEventListener('click', async () => {
            await this.skipStudy();
        });

        // Reset windowing
        document.getElementById('resetWindowing').addEventListener('click', () => {
            if (dicomViewer) {
                dicomViewer.resetWindowLevel();
            }
        });
    }

    async loadStudies() {
        try {
            const studiesSnapshot = await firebase.firestore()
                .collection('studies')
                .where('status', '==', 'ready')
                .get();
            
            this.studies = studiesSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            console.log(`Loaded ${this.studies.length} studies from Firestore`);
        } catch (error) {
            console.error('Error loading studies:', error);
            throw error;
        }
    }

    async loadUserProgress() {
        try {
            const progressDoc = await firebase.firestore()
                .collection('user_progress')
                .doc(this.currentUser.uid)
                .get();
            
            if (progressDoc.exists) {
                this.userProgress = progressDoc.data();
                console.log(`User has reviewed ${Object.keys(this.userProgress.annotations || {}).length} studies`);
            } else {
                this.userProgress = {
                    userId: this.currentUser.uid,
                    email: this.currentUser.email,
                    annotations: {},
                    skippedStudies: [],
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                };
            }
        } catch (error) {
            console.error('Error loading user progress:', error);
        }
    }

    updateStatistics() {
        const annotatedCount = Object.keys(this.userProgress.annotations || {}).length;
        const totalStudies = this.studies.length;
        const availableStudies = this.studies.filter(s => 
            !this.userProgress.annotations?.[s.study_id]
        ).length;
        
        document.getElementById('yourReviews').textContent = annotatedCount;
        document.getElementById('completedStudies').textContent = annotatedCount;
        document.getElementById('availableStudies').textContent = availableStudies;
        document.getElementById('totalStudies').textContent = totalStudies;
    }

    async loadNextStudy() {
        // Find next unannotated study
        const unannotatedStudy = this.studies.find(study => 
            !this.userProgress.annotations?.[study.study_id] &&
            !(this.userProgress.skippedStudies || []).includes(study.study_id)
        );
        
        if (!unannotatedStudy) {
            alert('🎉 All studies completed! Great work!');
            return;
        }
        
        await this.loadStudy(unannotatedStudy);
    }

    async loadStudy(study) {
        try {
            console.log(`Loading study ${study.study_id}`);
            
            // Find axial and sagittal series
            const axialSeries = this.findSeriesByOrientation(study, 'axial');
            const sagittalSeries = this.findSeriesByOrientation(study, 'sagittal');
            
            if (!axialSeries && !sagittalSeries) {
                console.error('No axial or sagittal series found for study');
                this.showErrorState('No suitable series found. Skipping study...');
                setTimeout(() => this.skipStudy(), 2000);
                return;
            }
            
            // Update UI
            document.getElementById('currentStudyId').textContent = study.study_id;
            
            // Show loading state
            this.showLoadingState('Loading DICOM files...');
            
            // Load DICOM files for both series
            const axialFiles = axialSeries ? await this.loadSeriesFiles(study.study_id, axialSeries) : [];
            const sagittalFiles = sagittalSeries ? await this.loadSeriesFiles(study.study_id, sagittalSeries) : [];
            
            // Load into dual viewer
            if (dicomViewer) {
                await dicomViewer.loadDualSeries(axialFiles, sagittalFiles);
                
                // Hide loading, show viewer
                document.getElementById('loadingMessage').style.display = 'none';
                document.getElementById('dualViewContainer').style.display = 'grid';
            }
            
            // Reset form
            document.getElementById('annotationForm').reset();
            
            this.currentStudy = study;
            
        } catch (error) {
            console.error('Error loading study:', error);
            this.showErrorState(`Error loading study: ${error.message}`);
        }
    }

    findSeriesByOrientation(study, orientation) {
        // Try to find series by description keywords
        const keywords = {
            'axial': ['ax', 'axial', 't2 ax', 'tra', 'transverse', 'trans'],
            'sagittal': ['sag', 'sagittal', 't2 sag', 't1 sag']
        };
        
        const searchTerms = keywords[orientation] || [];
        
        // Search through series
        for (const series of study.series) {
            const desc = (series.description || '').toLowerCase();
            if (searchTerms.some(term => desc.includes(term))) {
                return series;
            }
        }
        
        // Fallback: for axial, pick first series; for sagittal, pick second if available
        if (orientation === 'axial' && study.series.length > 0) {
            return study.series[0];
        }
        if (orientation === 'sagittal' && study.series.length > 1) {
            return study.series[1];
        }
        
        return null;
    }

    async loadSeriesFiles(studyId, series) {
        try {
            console.log(`Loading series ${series.series_id} for study ${studyId}...`);
            
            // Check if we have a file list
            if (series.files && Array.isArray(series.files)) {
                const filenames = series.files.map(f => f.filename);
                console.log(`Using ${filenames.length} filenames from Firestore metadata`);
                
                const files = await storageManager.downloadSeries(
                    studyId,
                    series.series_id,
                    filenames,
                    (current, total) => {
                        this.showLoadingState(`Loading ${series.description}: ${current}/${total}`);
                    }
                );
                
                if (files.length === 0) {
                    throw new Error(`No DICOM files downloaded for series ${series.series_id}`);
                }
                
                console.log(`Downloaded ${files.length} files for ${series.description}`);
                return files;
            }
            
            // Fallback to slice_count
            if (!series.slice_count || series.slice_count === 0) {
                throw new Error('Series has no slice_count or files list defined');
            }
            
            const filenames = [];
            for (let i = 1; i <= series.slice_count; i++) {
                filenames.push(i + '.dcm');
            }
            
            console.log(`Attempting to download ${filenames.length} DICOM files...`);
            
            const files = await storageManager.downloadSeries(
                studyId,
                series.series_id,
                filenames,
                (current, total) => {
                    this.showLoadingState(`Loading ${series.description}: ${current}/${total}`);
                }
            );
            
            if (files.length === 0) {
                throw new Error('No DICOM files could be downloaded');
            }
            
            return files;
            
        } catch (error) {
            console.error('Error loading DICOM files:', error);
            throw error;
        }
    }

    showLoadingState(message) {
        const loadingElement = document.getElementById('loadingMessage');
        if (loadingElement) {
            loadingElement.style.display = 'flex';
            const p = loadingElement.querySelector('p');
            if (p) p.textContent = message;
        }
        
        const viewerElement = document.getElementById('dualViewContainer');
        if (viewerElement) {
            viewerElement.style.display = 'none';
        }
    }

    showErrorState(message) {
        const loadingElement = document.getElementById('loadingMessage');
        if (loadingElement) {
            loadingElement.style.display = 'flex';
            loadingElement.innerHTML = `
                <div style="text-align: center; color: #ef4444;">
                    <p style="font-size: 1.2rem; margin-bottom: 1rem;">⚠️ Error</p>
                    <p>${message}</p>
                </div>
            `;
        }
    }

    async submitAnnotation() {
        try {
            const formData = new FormData(document.getElementById('annotationForm'));
            
            const annotation = {
                studyId: this.currentStudy.study_id,
                castellviType: formData.get('castellvi_type'),
                confidence: formData.get('confidence'),
                notes: formData.get('notes') || '',
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                userId: this.currentUser.uid,
                email: this.currentUser.email,
                axialSlice: dicomViewer.getCurrentSlices().axial,
                sagittalSlice: dicomViewer.getCurrentSlices().sagittal
            };
            
            // Save to Firestore
            await firebase.firestore()
                .collection('annotations')
                .add(annotation);
            
            // Update user progress
            this.userProgress.annotations = this.userProgress.annotations || {};
            this.userProgress.annotations[this.currentStudy.study_id] = {
                completed: true,
                timestamp: new Date().toISOString()
            };
            this.userProgress.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            
            await firebase.firestore()
                .collection('user_progress')
                .doc(this.currentUser.uid)
                .set(this.userProgress, { merge: true });
            
            console.log('✓ Annotation saved');
            
            // Update statistics
            this.updateStatistics();
            
            // Load next study
            await this.loadNextStudy();
            
        } catch (error) {
            console.error('Error submitting annotation:', error);
            alert('Error saving annotation. Please try again.');
        }
    }

    async skipStudy() {
        try {
            // Add to skipped list
            this.userProgress.skippedStudies = this.userProgress.skippedStudies || [];
            if (!this.userProgress.skippedStudies.includes(this.currentStudy.study_id)) {
                this.userProgress.skippedStudies.push(this.currentStudy.study_id);
            }
            
            await firebase.firestore()
                .collection('user_progress')
                .doc(this.currentUser.uid)
                .set(this.userProgress, { merge: true });
            
            console.log('✓ Study skipped');
            
            // Load next study
            await this.loadNextStudy();
            
        } catch (error) {
            console.error('Error skipping study:', error);
            alert('Error skipping study. Please try again.');
        }
    }
}

// Initialize app when DOM is ready
const app = new LSTVDualAnnotationApp();
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
