#!/usr/bin/env python3
"""
Upload DICOM files to Firebase Storage for LSTV annotation tool.

Features:
- Uploads DICOMs to Firebase Storage
- Creates metadata in Firestore
- Progress tracking with resume capability
- Batch processing for large datasets
- Trial mode for testing with small dataset
"""

import os
import sys
import json
import time
from pathlib import Path
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, storage, firestore
import pydicom

class DicomUploader:
    def __init__(self, service_account_path, bucket_name=None):
        """Initialize Firebase connection."""
        print("🔥 Initializing Firebase...")
        
        # Initialize Firebase Admin SDK
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred, {
            'storageBucket': bucket_name
        })
        
        self.bucket = storage.bucket()
        self.db = firestore.client()
        
        print("✅ Firebase initialized successfully")
        print(f"   Storage bucket: {self.bucket.name}")
    
    def get_dicom_metadata(self, dcm_path):
        """Extract basic metadata from DICOM file."""
        try:
            dcm = pydicom.dcmread(dcm_path, stop_before_pixels=True)
            return {
                'instance_number': int(dcm.InstanceNumber) if hasattr(dcm, 'InstanceNumber') else 0,
                'slice_location': float(dcm.SliceLocation) if hasattr(dcm, 'SliceLocation') else 0.0,
                'series_description': str(dcm.SeriesDescription) if hasattr(dcm, 'SeriesDescription') else 'Unknown'
            }
        except Exception as e:
            print(f"⚠️  Warning: Could not read DICOM metadata from {dcm_path}: {e}")
            return {
                'instance_number': 0,
                'slice_location': 0.0,
                'series_description': 'Unknown'
            }
    
    def upload_dicom_file(self, local_path, storage_path):
        """Upload single DICOM file to Firebase Storage."""
        blob = self.bucket.blob(storage_path)
        
        # Check if already exists
        if blob.exists():
            return False, "Already exists"
        
        # Upload file
        blob.upload_from_filename(
            local_path,
            content_type='application/dicom'
        )
        
        # Make publicly readable (authenticated users only via rules)
        return True, "Uploaded"
    
    def upload_series(self, study_id, series_id, series_dir):
        """Upload all DICOM files for a series."""
        dcm_files = sorted(series_dir.glob('*.dcm'))
        
        if not dcm_files:
            return None
        
        print(f"    Series {series_id}: {len(dcm_files)} files", end='', flush=True)
        
        uploaded_count = 0
        skipped_count = 0
        file_list = []
        
        for idx, dcm_file in enumerate(dcm_files, 1):
            # Storage path: dicoms/study_id/series_id/filename
            storage_path = f"dicoms/{study_id}/{series_id}/{dcm_file.name}"
            
            # Upload file
            uploaded, status = self.upload_dicom_file(str(dcm_file), storage_path)
            
            if uploaded:
                uploaded_count += 1
            else:
                skipped_count += 1
            
            # Get DICOM metadata
            metadata = self.get_dicom_metadata(str(dcm_file))
            
            # Track file info
            file_list.append({
                'filename': dcm_file.name,
                'storage_path': storage_path,
                'instance_number': metadata['instance_number'],
                'slice_location': metadata['slice_location'],
                'file_size': dcm_file.stat().st_size
            })
            
            # Progress indicator
            if idx % 5 == 0:
                print('.', end='', flush=True)
        
        # Get series description from first DICOM
        first_dcm_metadata = self.get_dicom_metadata(str(dcm_files[0]))
        
        print(f" ✅ ({uploaded_count} uploaded, {skipped_count} skipped)")
        
        return {
            'series_id': series_id,
            'description': first_dcm_metadata['series_description'],
            'slice_count': len(dcm_files),
            'files': file_list,
            'storage_path': f"dicoms/{study_id}/{series_id}/",
            'uploaded_count': uploaded_count,
            'skipped_count': skipped_count
        }
    
    def upload_study(self, study_dir):
        """Upload all series for a study."""
        study_id = int(study_dir.name)
        
        print(f"\n📁 Study {study_id}")
        
        # Find all series directories
        series_dirs = [d for d in study_dir.iterdir() if d.is_dir()]
        
        if not series_dirs:
            print(f"  ⚠️  No series directories found")
            return None
        
        series_list = []
        total_uploaded = 0
        total_skipped = 0
        
        for series_dir in sorted(series_dirs):
            series_id = int(series_dir.name)
            
            series_info = self.upload_series(study_id, series_id, series_dir)
            
            if series_info:
                series_list.append(series_info)
                total_uploaded += series_info['uploaded_count']
                total_skipped += series_info['skipped_count']
        
        # Create study metadata
        study_metadata = {
            'study_id': study_id,
            'series': series_list,
            'total_series': len(series_list),
            'total_slices': sum(s['slice_count'] for s in series_list),
            'upload_date': datetime.utcnow().isoformat(),
            'status': 'ready'
        }
        
        # Save to Firestore
        self.db.collection('studies').document(str(study_id)).set(study_metadata)
        
        print(f"  ✅ Study complete: {len(series_list)} series, "
              f"{total_uploaded} files uploaded, {total_skipped} skipped")
        
        return study_metadata
    
    def upload_studies(self, dicom_root, trial_mode=False, max_studies=None):
        """Upload multiple studies."""
        print("\n" + "="*70)
        print("🚀 LSTV DICOM Upload to Firebase Storage")
        print("="*70)
        
        dicom_root = Path(dicom_root)
        
        if not dicom_root.exists():
            print(f"❌ Directory not found: {dicom_root}")
            sys.exit(1)
        
        # Find all study directories
        study_dirs = [d for d in dicom_root.iterdir() if d.is_dir()]
        
        if not study_dirs:
            print(f"❌ No study directories found in {dicom_root}")
            sys.exit(1)
        
        # Limit studies if trial mode
        if max_studies:
            study_dirs = study_dirs[:max_studies]
        
        print(f"\n📊 Found {len(study_dirs)} studies to upload")
        
        if trial_mode:
            print(f"⚠️  TRIAL MODE: Uploading only {len(study_dirs)} studies")
            response = input("\nContinue? (yes/no): ")
            if response.lower() != 'yes':
                print("❌ Upload cancelled")
                sys.exit(0)
        
        print(f"\n⏰ Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*70)
        
        # Upload each study
        uploaded_studies = []
        failed_studies = []
        start_time = time.time()
        
        for idx, study_dir in enumerate(sorted(study_dirs), 1):
            print(f"\n[{idx}/{len(study_dirs)}]", end=' ')
            
            try:
                study_metadata = self.upload_study(study_dir)
                if study_metadata:
                    uploaded_studies.append(study_metadata)
                else:
                    failed_studies.append(study_dir.name)
            except Exception as e:
                print(f"  ❌ Error: {e}")
                failed_studies.append(study_dir.name)
        
        # Summary
        elapsed_time = time.time() - start_time
        
        print("\n" + "="*70)
        print("📊 UPLOAD SUMMARY")
        print("="*70)
        print(f"✅ Successfully uploaded: {len(uploaded_studies)} studies")
        print(f"❌ Failed: {len(failed_studies)} studies")
        print(f"⏱️  Total time: {elapsed_time/60:.1f} minutes")
        
        if failed_studies:
            print(f"\n⚠️  Failed studies: {', '.join(failed_studies)}")
        
        # Save metadata JSON
        metadata_json = {
            'version': '1.0',
            'generated_at': datetime.utcnow().isoformat(),
            'total_studies': len(uploaded_studies),
            'total_series': sum(s['total_series'] for s in uploaded_studies),
            'total_slices': sum(s['total_slices'] for s in uploaded_studies),
            'studies': uploaded_studies
        }
        
        output_path = 'data/study_metadata.json'
        os.makedirs('data', exist_ok=True)
        
        with open(output_path, 'w') as f:
            json.dump(metadata_json, f, indent=2)
        
        print(f"\n💾 Metadata saved to: {output_path}")
        print(f"   Total studies: {metadata_json['total_studies']}")
        print(f"   Total series: {metadata_json['total_series']}")
        print(f"   Total slices: {metadata_json['total_slices']}")
        
        print("\n✅ Upload complete!")
        
        return metadata_json

def main():
    """Main execution."""
    print("🔥 Firebase DICOM Uploader for LSTV Annotation Tool\n")
    
    # Check arguments
    if len(sys.argv) < 3:
        print("Usage: python upload_dicoms.py <service_account.json> <dicom_directory> [--trial]")
        print("\nExample (trial mode - 3 studies):")
        print("  python upload_dicoms.py scripts/firebase-service-account.json temp_dicoms/ --trial")
        print("\nExample (full upload):")
        print("  python upload_dicoms.py scripts/firebase-service-account.json /path/to/all/dicoms/")
        sys.exit(1)
    
    service_account_path = sys.argv[1]
    dicom_directory = sys.argv[2]
    trial_mode = '--trial' in sys.argv
    
    # Verify service account exists
    if not os.path.exists(service_account_path):
        print(f"❌ Service account file not found: {service_account_path}")
        sys.exit(1)
    
    # Load service account to get bucket name
    with open(service_account_path) as f:
        service_account_data = json.load(f)
        project_id = service_account_data['project_id']
        bucket_name = f"{project_id}.appspot.com"
    
    print(f"📋 Configuration:")
    print(f"   Project: {project_id}")
    print(f"   Bucket: {bucket_name}")
    print(f"   DICOM directory: {dicom_directory}")
    print(f"   Mode: {'TRIAL (3 studies)' if trial_mode else 'FULL UPLOAD'}")
    print()
    
    # Create uploader
    uploader = DicomUploader(service_account_path, bucket_name)
    
    # Upload studies
    max_studies = 3 if trial_mode else None
    metadata = uploader.upload_studies(dicom_directory, trial_mode, max_studies)
    
    print("\n🎉 All done!")
    print("\nNext steps:")
    print("1. Verify files in Firebase Console → Storage")
    print("2. Check metadata in Firebase Console → Firestore")
    print("3. If trial successful, run full upload without --trial flag")

if __name__ == '__main__':
    main()
