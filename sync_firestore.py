#!/usr/bin/env python3
"""
Sync Firestore metadata with Firebase Storage contents.
- Removes studies from Firestore that have no files in Storage
- Updates Firestore metadata to match actual files in Storage
- Creates missing Firestore entries for studies that exist in Storage
"""

import sys
import json
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, storage, firestore
import pydicom

class FirestoreStorageSync:
    def __init__(self, service_account_path, bucket_name):
        """Initialize Firebase connection."""
        print("🔥 Initializing Firebase...")
        
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred, {
            'storageBucket': bucket_name
        })
        
        self.bucket = storage.bucket()
        self.db = firestore.client()
        
        print("✅ Firebase initialized")
        print(f"   Storage: {self.bucket.name}")
        print()
    
    def get_storage_studies(self):
        """Scan Firebase Storage to find all studies and series."""
        print("📂 Scanning Firebase Storage...")
        
        # Get all blobs in dicoms/ folder
        blobs = list(self.bucket.list_blobs(prefix='dicoms/'))
        
        studies = {}
        
        for blob in blobs:
            # Parse path: dicoms/study_id/series_id/filename.dcm
            parts = blob.name.split('/')
            if len(parts) != 4 or not parts[3].endswith('.dcm'):
                continue
            
            study_id = parts[1]
            series_id = parts[2]
            filename = parts[3]
            
            if study_id not in studies:
                studies[study_id] = {}
            
            if series_id not in studies[study_id]:
                studies[study_id][series_id] = []
            
            studies[study_id][series_id].append(filename)
        
        print(f"   Found {len(studies)} studies in Storage")
        for study_id, series_dict in studies.items():
            total_files = sum(len(files) for files in series_dict.values())
            print(f"   - Study {study_id}: {len(series_dict)} series, {total_files} files")
        print()
        
        return studies
    
    def get_firestore_studies(self):
        """Get all studies from Firestore."""
        print("🗄️  Scanning Firestore...")
        
        studies_ref = self.db.collection('studies')
        firestore_studies = {}
        
        for doc in studies_ref.stream():
            study_data = doc.to_dict()
            study_id = study_data.get('study_id')
            firestore_studies[study_id] = {
                'doc_id': doc.id,
                'data': study_data
            }
        
        print(f"   Found {len(firestore_studies)} studies in Firestore")
        for study_id in firestore_studies:
            print(f"   - Study {study_id}")
        print()
        
        return firestore_studies
    
    def download_dicom_metadata(self, study_id, series_id, filename):
        """Download and parse DICOM metadata from Storage."""
        try:
            blob_path = f"dicoms/{study_id}/{series_id}/{filename}"
            blob = self.bucket.blob(blob_path)
            
            # Download to memory
            dcm_bytes = blob.download_as_bytes()
            
            # Parse DICOM (only header, not pixels)
            from io import BytesIO
            dcm = pydicom.dcmread(BytesIO(dcm_bytes), stop_before_pixels=True)
            
            return {
                'instance_number': int(dcm.InstanceNumber) if hasattr(dcm, 'InstanceNumber') else 0,
                'slice_location': float(dcm.SliceLocation) if hasattr(dcm, 'SliceLocation') else 0.0,
                'series_description': str(dcm.SeriesDescription) if hasattr(dcm, 'SeriesDescription') else ''
            }
        except Exception as e:
            print(f"      ⚠️  Could not read metadata from {filename}: {e}")
            return {
                'instance_number': 0,
                'slice_location': 0.0,
                'series_description': ''
            }
    
    def create_study_metadata(self, study_id, series_dict):
        """Create Firestore metadata from Storage files."""
        print(f"   Creating metadata for study {study_id}...")
        
        series_list = []
        
        for series_id, filenames in series_dict.items():
            print(f"      Series {series_id}: {len(filenames)} files", end='', flush=True)
            
            # Sort filenames numerically
            filenames_sorted = sorted(filenames, key=lambda x: int(''.join(filter(str.isdigit, x)) or '0'))
            
            # Get description from first file
            first_file_metadata = self.download_dicom_metadata(study_id, series_id, filenames_sorted[0])
            
            # Create file list
            file_list = []
            for filename in filenames_sorted:
                metadata = self.download_dicom_metadata(study_id, series_id, filename)
                file_list.append({
                    'filename': filename,
                    'instance_number': metadata['instance_number'],
                    'slice_location': metadata['slice_location']
                })
            
            series_list.append({
                'series_id': str(series_id),
                'description': first_file_metadata['series_description'],
                'slice_count': len(filenames),
                'files': file_list,
                'storage_path': f"dicoms/{study_id}/{series_id}/"
            })
            
            print(" ✅")
        
        return {
            'study_id': str(study_id),
            'series': series_list,
            'total_series': len(series_list),
            'total_slices': sum(s['slice_count'] for s in series_list),
            'upload_date': firestore.SERVER_TIMESTAMP,
            'status': 'ready'
        }
    
    def sync(self, dry_run=True):
        """Sync Firestore with Storage."""
        print("=" * 70)
        print("🔄 SYNCING FIRESTORE WITH FIREBASE STORAGE")
        print("=" * 70)
        print()
        
        storage_studies = self.get_storage_studies()
        firestore_studies = self.get_firestore_studies()
        
        print("=" * 70)
        print("📊 ANALYSIS")
        print("=" * 70)
        print()
        
        # Find studies in Firestore but NOT in Storage (orphans)
        orphaned_studies = set(firestore_studies.keys()) - set(storage_studies.keys())
        
        # Find studies in Storage but NOT in Firestore (missing)
        missing_studies = set(storage_studies.keys()) - set(firestore_studies.keys())
        
        # Find studies in both (may need updates)
        existing_studies = set(storage_studies.keys()) & set(firestore_studies.keys())
        
        print(f"🗑️  Orphaned (in Firestore, not in Storage): {len(orphaned_studies)}")
        for study_id in orphaned_studies:
            print(f"   - Study {study_id} ❌")
        print()
        
        print(f"➕ Missing (in Storage, not in Firestore): {len(missing_studies)}")
        for study_id in missing_studies:
            print(f"   - Study {study_id} 📁")
        print()
        
        print(f"✅ Existing (in both): {len(existing_studies)}")
        for study_id in existing_studies:
            storage_files = sum(len(files) for files in storage_studies[study_id].values())
            firestore_files = firestore_studies[study_id]['data'].get('total_slices', 0)
            match = "✓" if storage_files == firestore_files else "⚠️"
            print(f"   - Study {study_id}: Storage={storage_files} files, Firestore={firestore_files} files {match}")
        print()
        
        if dry_run:
            print("=" * 70)
            print("🔍 DRY RUN MODE - NO CHANGES WILL BE MADE")
            print("=" * 70)
            print()
            print("Actions that would be performed:")
            print(f"  - Delete {len(orphaned_studies)} orphaned studies from Firestore")
            print(f"  - Create {len(missing_studies)} missing studies in Firestore")
            print(f"  - Update {len(existing_studies)} existing studies in Firestore")
            print()
            print("Run with --apply to actually make these changes")
            return
        
        print("=" * 70)
        print("💾 APPLYING CHANGES")
        print("=" * 70)
        print()
        
        # Delete orphaned studies
        if orphaned_studies:
            print(f"🗑️  Deleting {len(orphaned_studies)} orphaned studies...")
            for study_id in orphaned_studies:
                doc_id = firestore_studies[study_id]['doc_id']
                self.db.collection('studies').document(doc_id).delete()
                print(f"   ✅ Deleted study {study_id}")
            print()
        
        # Create missing studies
        if missing_studies:
            print(f"➕ Creating {len(missing_studies)} missing studies...")
            for study_id in missing_studies:
                metadata = self.create_study_metadata(study_id, storage_studies[study_id])
                self.db.collection('studies').document(str(study_id)).set(metadata)
                print(f"   ✅ Created study {study_id}")
            print()
        
        # Update existing studies
        if existing_studies:
            print(f"🔄 Updating {len(existing_studies)} existing studies...")
            for study_id in existing_studies:
                metadata = self.create_study_metadata(study_id, storage_studies[study_id])
                self.db.collection('studies').document(str(study_id)).set(metadata)
                print(f"   ✅ Updated study {study_id}")
            print()
        
        print("=" * 70)
        print("✅ SYNC COMPLETE!")
        print("=" * 70)
        print()
        print("Summary:")
        print(f"  - Deleted: {len(orphaned_studies)} studies")
        print(f"  - Created: {len(missing_studies)} studies")
        print(f"  - Updated: {len(existing_studies)} studies")
        print()

def main():
    if len(sys.argv) < 2:
        print("Usage: python sync_firestore.py <service_account.json> [--apply]")
        print()
        print("By default, runs in DRY RUN mode (shows what would change)")
        print("Add --apply to actually make changes")
        print()
        print("Examples:")
        print("  python sync_firestore.py firebase-service-account.json")
        print("  python sync_firestore.py firebase-service-account.json --apply")
        sys.exit(1)
    
    service_account_path = sys.argv[1]
    dry_run = '--apply' not in sys.argv
    
    # Load service account to get bucket name
    with open(service_account_path) as f:
        service_account_data = json.load(f)
        project_id = service_account_data['project_id']
    
    bucket_name = f"{project_id}.firebasestorage.app"
    
    syncer = FirestoreStorageSync(service_account_path, bucket_name)
    syncer.sync(dry_run=dry_run)
    
    if dry_run:
        print("To apply these changes, run:")
        print(f"  python sync_firestore.py {service_account_path} --apply")

if __name__ == '__main__':
    main()
