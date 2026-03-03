// src/navigation/types.ts

import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

// Define all routes and their params
export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  // Future screens
  SignUp: undefined;
  ForgotPassword: { email?: string };
  Home: undefined;
  Dashboard: undefined;
  Main: undefined;
  InspectionList: undefined;
  InspectionDetail: { inspectionId: string };
  InspectionExecution: { inspectionId?: string };
  InspectionSuccess: undefined;
  Profile: undefined;
  Settings: undefined;
  Notifications: undefined;
  ReportViewer: { reportId?: string };
  Equipment: undefined;
  ContractSign: { inspectionId?: string; nextScreen?: string };
  Expenses: undefined;
  AssetScanner: undefined;
};

// Navigation prop types for each screen
export type SplashScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Splash'
>;

export type LoginScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Login'
>;

// Generic navigation prop
export type AppNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Route prop types
export type SplashScreenRouteProp = RouteProp<RootStackParamList, 'Splash'>;
export type LoginScreenRouteProp = RouteProp<RootStackParamList, 'Login'>;

// Screen props combining navigation and route
export type SplashScreenProps = {
  navigation: SplashScreenNavigationProp;
  route: SplashScreenRouteProp;
};

export type LoginScreenProps = {
  navigation: LoginScreenNavigationProp;
  route: LoginScreenRouteProp;
};

export type DashboardScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Dashboard'
>;

export type DashboardScreenRouteProp = RouteProp<RootStackParamList, 'Dashboard'>;

export type DashboardScreenProps = {
  navigation: DashboardScreenNavigationProp;
  route: DashboardScreenRouteProp;
};

export type InspectionDetailScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'InspectionDetail'
>;

export type InspectionDetailScreenRouteProp = RouteProp<RootStackParamList, 'InspectionDetail'>;

export type InspectionDetailScreenProps = {
  navigation: InspectionDetailScreenNavigationProp;
  route: InspectionDetailScreenRouteProp;
};

export type InspectionExecutionScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'InspectionExecution'
>;

export type InspectionExecutionScreenRouteProp = RouteProp<RootStackParamList, 'InspectionExecution'>;

export type InspectionExecutionScreenProps = {
  navigation: InspectionExecutionScreenNavigationProp;
  route: InspectionExecutionScreenRouteProp;
};

export type ProfileScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Profile'
>;

export type ProfileScreenRouteProp = RouteProp<RootStackParamList, 'Profile'>;

export type ProfileScreenProps = {
  navigation: ProfileScreenNavigationProp;
  route: ProfileScreenRouteProp;
};
