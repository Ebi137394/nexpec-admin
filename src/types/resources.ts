// src/types/resources.ts

export interface Course {
  id: string;
  title: string;
  instructor: string;
  duration: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  category: string;
  thumbnail_url: string | null;
  description: string | null;
  lessons_count: number;
  created_at: string;
}

export interface UserCourseProgress {
  user_id: string;
  course_id: string;
  progress_percent: number;
  status: 'not_started' | 'in_progress' | 'completed';
  last_accessed_at: string | null;
}

export interface CourseWithProgress extends Course {
  progress: number;
  status: 'not_started' | 'in_progress' | 'completed';
  lastAccessed: string | null;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  type: 'PDF' | 'Video' | 'Article' | 'Checklist' | 'Guide' | 'Standard';
  file_url: string;
  category: string | null;
  description: string | null;
  file_size: string | null;
  downloads_count: number;
  created_at: string;
}

export interface AcademyStats {
  avgProgress: number;
  completedCount: number;
  inProgressCount: number;
  totalCourses: number;
  totalHours: number;
}

export interface Milestone {
  id: string;
  title: string;
  icon: string;
  threshold: number;
  unlocked: boolean;
  color: string;
}