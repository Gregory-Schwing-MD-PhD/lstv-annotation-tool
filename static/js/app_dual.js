class LSTVDualAnnotationApp {
    constructor() {
        this.currentUser = null;
        this.studies = [];
        this.currentStudy = null;
        this.userProgress = {};
    }

    async init() {
        try {
            console.log('Initializing LSTV Dual Annotation Tool...');
            
            await authManager.init();
            this.currentUser = authManager.getUser();
            
            if (!this.currentUser) {
                window.location.href = 'login.html';
                return;
            }
            
            document.getElementById('userName').textContent = this.currentUser.email;
            
            dicomViewer = new DualDicomViewer('axialViewer', 'sagittalViewer');
            
            this.setupEventListeners();
            await this.loadStudies();
            await this.loadUserProgress();
            this.updateStatistics();
            await this.loadNextStudy();
            
        } catch (error) {
            console.error('Initialization Error:', error);
            alert('Initialization failed. Check console.');
        }
    }

    setupEventListeners() {
        document.getElementById('signOutBtn').addEventListener('click', async () => {
            await authManager.signOut();
            window.location.href = 'login.html';
        });

        document.getElementById('annotationForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitAnnotation();
        });

        document.getElementById('skipStudy').addEventListener('click', () => {
            this.skipStudy();
        });

        document.getElementById('resetWindowing').addEventListener('click', () => {
            if (dicomViewer) dicomViewer.resetWindowLevel();
        });
    }

    async loadStudies() {
        const snap = await firebase.firestore().collection('studies').where('status', '==', 'ready').get();
        this.studies = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async loadUserProgress() {
        const doc = await firebase.firestore().collection('user_progress').doc(this.currentUser.uid).get();
        this.userProgress = doc.exists ? doc.data() : { annotations: {}, skippedStudies: [] };
    }

    updateStatistics() {
        const completed = Object.keys(this.userProgress.annotations || {}).length;
        const total = this.studies.length;
        document.getElementById('completedStudies').textContent = completed;
        document.getElementById('totalStudies').textContent = total;
        document.getElementById('availableStudies').textContent = total - completed;
    }

    async loadNextStudy() {
        const next = this.studies.find(s => 
            !this.userProgress.annotations?.[s.study_id] && 
            !this.userProgress.skippedStudies?.includes(s.study_id)
        );

        if (!next) {
            alert('All studies completed!');
            return;
        }

        await this.loadStudy(next);
    }

    async loadStudy(study) {
        this.currentStudy = study;
        document.getElementById('currentStudyId').textContent = study.study_id;
        
        // Show Loading
        const loadingEl = document.getElementById('loadingMessage');
        loadingEl.style.display = 'flex';
        
        // ⚠️ CRITICAL: Show the container NOW so it has height when JS runs
        const container = document.getElementById('dualViewContainer');
        container.style.display = 'grid'; 
        container.style.visibility = 'visible';
        container.style.opacity = '1';

        try {
            const axSeries = study.series.find(s => s.description.toLowerCase().includes('ax'));
            const sagSeries = study.series.find(s => s.description.toLowerCase().includes('sag'));
            
            const finalAx = axSeries || study.series[0];
            const finalSag = sagSeries || (study.series[1] || study.series[0]);

            const axFiles = await this.fetchFiles(study.study_id, finalAx);
            const sagFiles = await this.fetchFiles(study.study_id, finalSag);

            await dicomViewer.loadDualSeries(axFiles, sagFiles);

            // Hide Loading once pixels are drawn
            loadingEl.style.display = 'none';
            dicomViewer.resize();

        } catch (error) {
            console.error(error);
            alert('Failed to load study files.');
        }
    }

    async fetchFiles(studyId, series) {
        let filenames = [];
        if (series.files) {
            filenames = series.files.map(f => f.filename);
        } else if (series.slice_count) {
            filenames = Array.from({length: series.slice_count}, (_, i) => `${i + 1}.dcm`);
        } else {
            filenames = ['1.dcm', '2.dcm', '3.dcm']; 
        }

        return await storageManager.downloadSeries(studyId, series.series_id, filenames, (current, total) => {
            const loadingEl = document.getElementById('loadingMessage');
            if (!loadingEl) return;
            
            const text = `Downloading ${series.description || 'series'}: ${current}/${total}`;
            const span = loadingEl.querySelector('span');
            
            if (span) span.textContent = text;
            else loadingEl.textContent = text;
        });
    }

    async submitAnnotation() {
        const formData = new FormData(document.getElementById('annotationForm'));
        const data = Object.fromEntries(formData.entries());
        
        await firebase.firestore().collection('annotations').add({
            studyId: this.currentStudy.study_id,
            userId: this.currentUser.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            ...data,
            slices: dicomViewer.getCurrentSlices()
        });

        if (!this.userProgress.annotations) this.userProgress.annotations = {};
        this.userProgress.annotations[this.currentStudy.study_id] = true;
        
        await firebase.firestore().collection('user_progress').doc(this.currentUser.uid).set(this.userProgress, {merge: true});
        
        this.updateStatistics();
        this.loadNextStudy();
    }

    async skipStudy() {
        if (!this.userProgress.skippedStudies) this.userProgress.skippedStudies = [];
        this.userProgress.skippedStudies.push(this.currentStudy.study_id);
        
        await firebase.firestore().collection('user_progress').doc(this.currentUser.uid).set(this.userProgress, {merge: true});
        this.loadNextStudy();
    }
}

const app = new LSTVDualAnnotationApp();
document.addEventListener('DOMContentLoaded', () => app.init());
