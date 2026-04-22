import type { LibraryManifest } from '../types'

export const sampleLibraryManifest = {
  version: 1,
  title: 'Owned Quest Builds',
  description:
    'A sample manifest for APK and OBB files you already own. Replace these entries with your own titles or import a JSON manifest from the app.',
  ownershipStatement:
    'Only install software that you created, purchased, or otherwise have the rights to sideload.',
  games: [
    {
      id: 'orbit-atelier',
      title: 'Orbit Atelier',
      packageName: 'com.example.orbitatelier',
      developer: 'Northwind Lab',
      description:
        'A creative sandbox entry that expects one APK and one OBB file from your local library folder.',
      notes:
        'Use this as a template for a typical Quest app with expansion content. Rename the file specs to match your own build outputs.',
      releaseNotes:
        'Version 42 sample manifest. Replace with your own package version and notes.',
      accent: '#0f766e',
      genres: ['creative', 'sandbox'],
      apks: [{ fileName: 'orbit-atelier.apk', label: 'Base APK' }],
      obbs: [
        {
          fileName: 'main.42.com.example.orbitatelier.obb',
          label: 'Main OBB',
        },
      ],
    },
    {
      id: 'drift-chamber',
      title: 'Drift Chamber',
      packageName: 'com.example.driftchamber',
      developer: 'Cinder Arcade',
      description:
        'A fast action prototype that uses a single APK with no expansion files.',
      notes:
        'Good fit for smaller demos, internal playtests, and homebrew builds you just want to push over USB from the browser.',
      releaseNotes: 'Single-package sample install target.',
      accent: '#b45309',
      genres: ['action', 'prototype'],
      apks: [{ fileName: 'drift-chamber.apk', label: 'Quest APK' }],
    },
    {
      id: 'puzzle-terrace',
      title: 'Puzzle Terrace',
      packageName: 'com.example.puzzleterrace',
      developer: 'Signal House',
      description:
        'A content-heavy title that shows how to model multiple OBB archives in a user-owned manifest.',
      notes:
        'If your build ships multiple OBBs, list each expected filename here and the app will push them to the correct package folder.',
      releaseNotes: 'Sample for multi-OBB local installs.',
      accent: '#7c3aed',
      genres: ['puzzle', 'atmospheric'],
      apks: [{ fileName: 'puzzle-terrace.apk', label: 'Game APK' }],
      obbs: [
        {
          fileName: 'main.9.com.example.puzzleterrace.obb',
          label: 'Main OBB',
        },
        {
          fileName: 'patch.9.com.example.puzzleterrace.obb',
          label: 'Patch OBB',
          optional: true,
        },
      ],
    },
  ],
} satisfies LibraryManifest
