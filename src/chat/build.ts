/**
 * Build preferences and configuration for app generation
 */

import chalk from 'chalk';
import { select, multiselect, text } from '../utils/prompts.js';
import type { BuildPreferences } from './types.js';

// Build preferences options for app generation
export const BUILD_TECH_OPTIONS = [
  { name: 'nextjs', message: 'Next.js (React, App Router)' },
  { name: 'react', message: 'React (Vite)' },
  { name: 'vue', message: 'Vue.js (Nuxt)' },
  { name: 'astro', message: 'Astro' },
  { name: 'remix', message: 'Remix' },
] as const;

export const BUILD_DESIGN_OPTIONS = [
  { name: 'modern', message: 'Modern & Clean' },
  { name: 'minimal', message: 'Minimal & Simple' },
  { name: 'bold', message: 'Bold & Colorful' },
  { name: 'elegant', message: 'Elegant & Professional' },
  { name: 'playful', message: 'Playful & Fun' },
] as const;

export const BUILD_FEATURE_OPTIONS = [
  { name: 'responsive', message: 'Mobile Responsive' },
  { name: 'darkmode', message: 'Dark Mode Support' },
  { name: 'animations', message: 'Smooth Animations' },
  { name: 'seo', message: 'SEO Optimized' },
  { name: 'accessibility', message: 'Accessibility (a11y)' },
  { name: 'typescript', message: 'TypeScript' },
] as const;

/**
 * Gather app build preferences from the user
 * Returns a rich prompt that includes technology, design, and feature preferences
 */
export async function gatherBuildPreferences(initialDescription?: string): Promise<BuildPreferences> {
  console.log();
  console.log(chalk.cyan('  Let\'s customize your app:'));
  console.log();

  // Get app description
  const description = initialDescription || await text({
    message: 'Describe your app:',
    required: true,
  });

  // Select technology
  const technology = await select({
    message: 'Framework:',
    choices: BUILD_TECH_OPTIONS.map(o => ({ name: o.name, message: o.message })),
  });

  // Select design style
  const design = await select({
    message: 'Design style:',
    choices: BUILD_DESIGN_OPTIONS.map(o => ({ name: o.name, message: o.message })),
  });

  // Select features (multi-select)
  const features = await multiselect({
    message: 'Features (space to select, enter to confirm):',
    choices: BUILD_FEATURE_OPTIONS.map(o => ({ name: o.name, message: o.message })),
    initial: [0, 3], // Default: responsive and SEO
  });

  return { description, technology, design, features };
}

/**
 * Build a rich prompt from build preferences
 */
export function buildPromptFromPreferences(prefs: BuildPreferences): string {
  const techMap: Record<string, string> = {
    nextjs: 'Next.js with App Router',
    react: 'React with Vite',
    vue: 'Vue.js with Nuxt',
    astro: 'Astro',
    remix: 'Remix',
  };

  const designMap: Record<string, string> = {
    modern: 'modern and clean',
    minimal: 'minimal and simple',
    bold: 'bold and colorful',
    elegant: 'elegant and professional',
    playful: 'playful and fun',
  };

  const featureMap: Record<string, string> = {
    responsive: 'fully mobile responsive',
    darkmode: 'dark mode support',
    animations: 'smooth animations and transitions',
    seo: 'SEO optimized with proper meta tags',
    accessibility: 'accessible (WCAG compliant)',
    typescript: 'TypeScript for type safety',
  };

  const tech = techMap[prefs.technology] || 'Next.js';
  const design = designMap[prefs.design] || 'modern';
  const featureList = prefs.features.map(f => featureMap[f] || f).join(', ');

  return `Build ${prefs.description}

Technical Requirements:
- Framework: ${tech}
- Design: ${design} aesthetic with Tailwind CSS
- Features: ${featureList || 'responsive design'}

Please create a complete, production-ready application.`;
}
