import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

interface LogoProps {
  width?: number;
  height?: number;
  color?: string; // رنگ اصلی (بنفش برند)
  accent?: string; // رنگ دوم برای درخشش (مثلا فیروزه‌ای یا سفید)
}

export default function NexpecLogo({ 
  width = 100, 
  height = 100, 
  color = "#8B5CF6", // رنگ بنفش اصلی پروژه
  accent = "#00D4AA" // رنگ فیروزه‌ای برای مرکز هدف
}: LogoProps) {
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={width} height={height} viewBox="0 0 100 100" fill="none">
        <Defs>
          <LinearGradient id="grad" x1="0" y1="0" x2="100" y2="100">
            <Stop offset="0" stopColor={color} stopOpacity="1" />
            <Stop offset="1" stopColor={color} stopOpacity="0.7" />
          </LinearGradient>
        </Defs>
        
        {/* چهار بازوی اسکنر که حرف X را می‌سازند */}
        {/* بالا چپ */}
        <Path 
          d="M20 20 L45 45 L35 55 L10 30 Z" 
          fill="url(#grad)" 
        />
        {/* بالا راست */}
        <Path 
          d="M80 20 L55 45 L65 55 L90 30 Z" 
          fill="url(#grad)" 
        />
         {/* پایین چپ */}
         <Path 
          d="M20 80 L45 55 L35 45 L10 70 Z" 
          fill="url(#grad)" 
        />
         {/* پایین راست */}
         <Path 
          d="M80 80 L55 55 L65 45 L90 70 Z" 
          fill="url(#grad)" 
        />

        {/* نقطه مرکزی (هدف/داده) */}
        <Circle cx="50" cy="50" r="8" fill={accent} />
        
        {/* یک حلقه ظریف دور مرکز برای حس لنز دوربین */}
        <Circle cx="50" cy="50" r="15" stroke={color} strokeWidth="2" opacity="0.5" />
      </Svg>
    </View>
  );
}
