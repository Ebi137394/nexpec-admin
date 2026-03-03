// types/db.ts

export type UserRole = 'client' | 'inspector' | 'admin' | 'guest' | null;
export type ProjectStatus = 'Open' | 'In_Progress' | 'Completed' | 'Cancelled';
export type InspectionResult = 'Pass' | 'Fail' | 'NCR';

export interface Profile {
  id: string;              // Maps to auth.users.id
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;          // Default is 'inspector'
  category: string | null; // e.g., 'Welding', 'NDT'
  location: string | null; // e.g., 'Montreal, QC'
  years_experience: number | null; //
  created_at: string;
  updated_at: string;      //
}

export interface Project {
  id: string;
  client_id: string | null;
  title: string;
  description: string | null;
  category: string;        //
  location: string;        
  price: number;           // Use 'price' to match SQL
  currency: string;        // Default 'CAD'
  status: ProjectStatus;
  created_at: string;
  updated_at: string;      //
}

export interface Report {
  id: string;
  project_id: string;      // Required for link
  inspector_id: string;    // Required for link
  serial_number: string;   //
  inspection_type: string; // 'Visual', 'NDT', or 'Both'
  notes: string | null;    //
  image_url: string | null;//
  status: string;          // e.g., 'Submitted', 'Approved'
  created_at: string;
}

export interface Application {
  id: string;
  project_id: string;
  applicant_id: string;    // Use 'applicant_id' to match SQL
  status: string;          // 'Pending', 'Accepted', 'Rejected'
  created_at: string;
}
