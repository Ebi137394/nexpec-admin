// src/hooks/useAcademyData.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type {
  Course,
  CourseWithProgress,
  AcademyStats,
  Milestone,
} from '../types/resources';

const CACHE_KEY_COURSES = '@nexpec_courses_cache';
const CACHE_KEY_PROGRESS = '@nexpec_progress_cache';

function parseDurationToHours(duration: string): number {
  const lower = duration.toLowerCase();
  const nums = parseFloat(lower.replace(/[^0-9.]/g, '')) || 0;
  if (lower.includes('hr') || lower.includes('hour')) return nums;
  if (lower.includes('min')) return nums / 60;
  if (lower.includes('day')) return nums * 8;
  return nums;
}

function computeStats(courses: CourseWithProgress[]): AcademyStats {
  if (courses.length === 0) {
    return {
      avgProgress: 0,
      completedCount: 0,
      inProgressCount: 0,
      totalCourses: 0,
      totalHours: 0,
    };
  }

  const completedCount = courses.filter((c) => c.status === 'completed').length;
  const inProgressCount = courses.filter(
    (c) => c.status === 'in_progress'
  ).length;
  const totalProgress = courses.reduce((sum, c) => sum + c.progress, 0);
  const avgProgress = Math.round(totalProgress / courses.length);
  const totalHours = courses.reduce(
    (sum, c) => sum + parseDurationToHours(c.duration),
    0
  );

  return {
    avgProgress,
    completedCount,
    inProgressCount,
    totalCourses: courses.length,
    totalHours: Math.round(totalHours * 10) / 10,
  };
}

function computeMilestones(completedCount: number): Milestone[] {
  const defs: Omit<Milestone, 'unlocked'>[] = [
    {
      id: 'm1',
      title: 'First Step',
      icon: 'rocket-outline',
      threshold: 1,
      color: '#00B894',
    },
    {
      id: 'm2',
      title: 'Fast Learner',
      icon: 'flash-outline',
      threshold: 3,
      color: '#FDCB6E',
    },
    {
      id: 'm3',
      title: 'Halfway Hero',
      icon: 'medal-outline',
      threshold: 5,
      color: '#74b9ff',
    },
    {
      id: 'm4',
      title: 'Expert',
      icon: 'trophy-outline',
      threshold: 10,
      color: '#e17055',
    },
    {
      id: 'm5',
      title: 'Master',
      icon: 'diamond-outline',
      threshold: 20,
      color: '#a29bfe',
    },
  ];
  return defs.map((d) => ({ ...d, unlocked: completedCount >= d.threshold }));
}

export function useAcademyData(refreshTrigger: number = 0) {
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [stats, setStats] = useState<AcademyStats>({
    avgProgress: 0,
    completedCount: 0,
    inProgressCount: 0,
    totalCourses: 0,
    totalHours: 0,
  });
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const isMounted = useRef(true);

  const processData = useCallback(
    (
      rawCourses: Course[],
      progressMap: Record<
        string,
        { progress_percent: number; status: string; last_accessed_at: string | null }
      >
    ) => {
      const merged: CourseWithProgress[] = rawCourses.map((c) => {
        const prog = progressMap[c.id];
        return {
          ...c,
          progress: prog ? prog.progress_percent : 0,
          status: (prog?.status as CourseWithProgress['status']) || 'not_started',
          lastAccessed: prog?.last_accessed_at || null,
        };
      });

      const uniqueCategories = [
        'All',
        ...Array.from(new Set(rawCourses.map((c) => c.category))).sort(),
      ];

      const computedStats = computeStats(merged);
      const computedMilestones = computeMilestones(computedStats.completedCount);

      if (isMounted.current) {
        setCourses(merged);
        setStats(computedStats);
        setMilestones(computedMilestones);
        setCategories(uniqueCategories);
      }
    },
    []
  );

  const loadCachedData = useCallback(async () => {
    try {
      const [cachedCourses, cachedProgress] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY_COURSES),
        AsyncStorage.getItem(CACHE_KEY_PROGRESS),
      ]);
      if (cachedCourses) {
        const rawCourses: Course[] = JSON.parse(cachedCourses);
        const progressMap = cachedProgress ? JSON.parse(cachedProgress) : {};
        processData(rawCourses, progressMap);
        setIsOfflineData(true);
        return true;
      }
    } catch {
      // Cache read failed – proceed to network
    }
    return false;
  }, [processData]);

  const fetchFromSupabase = useCallback(async () => {
    try {
      // 1. Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // 2. Fetch all courses
      const { data: coursesData, error: coursesError } = await supabase
        .from('courses')
        .select('*')
        .order('created_at', { ascending: false });

      if (coursesError) throw coursesError;
      const rawCourses: Course[] = coursesData || [];

      // 3. Fetch progress if user is authenticated
      let progressMap: Record<
        string,
        { progress_percent: number; status: string; last_accessed_at: string | null }
      > = {};

      if (user) {
        const { data: progressData, error: progressError } = await supabase
          .from('user_course_progress')
          .select('course_id, progress_percent, status, last_accessed_at')
          .eq('user_id', user.id);

        if (progressError) throw progressError;

        (progressData || []).forEach((p: any) => {
          progressMap[p.course_id] = {
            progress_percent: p.progress_percent,
            status: p.status,
            last_accessed_at: p.last_accessed_at,
          };
        });
      }

      // 4. Process and cache
      processData(rawCourses, progressMap);
      setIsOfflineData(false);
      setError(null);

      // Cache for offline use
      await AsyncStorage.setItem(
        CACHE_KEY_COURSES,
        JSON.stringify(rawCourses)
      );
      await AsyncStorage.setItem(
        CACHE_KEY_PROGRESS,
        JSON.stringify(progressMap)
      );
    } catch (err: any) {
      if (isMounted.current) {
        setError(err.message || 'Failed to load courses');
      }
      // If network failed and no data loaded yet, try cache
      if (courses.length === 0) {
        await loadCachedData();
      }
    }
  }, [processData, loadCachedData, courses.length]);

  const refetch = useCallback(async () => {
    if (isMounted.current) setLoading(true);
    await fetchFromSupabase();
    if (isMounted.current) setLoading(false);
  }, [fetchFromSupabase]);

  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;

    (async () => {
      // Step 1: Load cache instantly (so UI isn't blank)
      const hadCache = await loadCachedData();
      if (hadCache && isMounted.current) setLoading(false);

      // Step 2: Fetch fresh data from Supabase
      await fetchFromSupabase();
      if (!cancelled && isMounted.current) setLoading(false);
    })();

    return () => {
      cancelled = true;
      isMounted.current = false;
    };
  }, [refreshTrigger]);

  // Derive the "Continue Learning" course
  const continueLearningCourse = courses
    .filter((c) => c.status === 'in_progress' && c.progress < 100)
    .sort((a, b) => b.progress - a.progress)[0] || null;

  return {
    courses,
    stats,
    milestones,
    categories,
    continueLearningCourse,
    loading,
    error,
    isOfflineData,
    refetch,
  };
}