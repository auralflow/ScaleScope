SCALESCOPE — USER GUIDE
=======================

Launch
------
1. Open “ScaleScope.html” with a double-click.
2. The tool opens in your browser. No installation or server is required.
3. For best compatibility, use a current version of Chrome or Safari on macOS.

Online version
--------------
Open https://auralflow.github.io/ScaleScope/ in a browser to use the hosted
version without downloading the standalone file.

An internet connection is not required. Imported audio is processed only on
your computer and is never uploaded anywhere.


Selecting notes
---------------
• Click piano keys or positions on the guitar fretboard.
• A selected note is highlighted in every octave and across all views.
• Click it again to remove it.
• Undo / Redo revert and restore changes. Undo shortcut: Ctrl+Z or Cmd+Z.
• Clear all removes every selected note.


Scale list
----------
• With no notes selected, all 34 Korg Electribe 2 scales are shown in all 12 keys.
• Search works by root, scale name, or note. Examples: “F Japanese”, “D Dorian”, “C# Ionian”.
• Hover over a card to preview its notes on the piano and guitar fretboard.
• Click a card to select the full scale.
• When notes are already selected, the list shows compatible scales. Exact means an exact match.


Camelot wheel
-------------
• Color shows how compatible the selected notes are with a key.
• A bright outline means full compatibility.
• Hovering previews the notes of that key.
• Clicking selects all notes of that key and replaces the previous selection.


Audio analysis
--------------
• The Audio file / Microphone switch is located above the spectrum.

Audio file mode:
1. Drop an audio file onto the spectrum or click Choose file.
2. WAV and MP3 are supported. M4A/AAC and FLAC work when the browser can decode them.
3. Play / Pause starts and stops playback. You can also press Space.
4. In Loop mode, the selected range repeats and the spectrum is calculated for that range.
5. With Loop off, the spectrum follows the current playback position.
6. Use the Audio slider in the waveform toolbar to adjust file playback volume.
7. Replace audio switches the file; Delete audio removes it from the current session.

Microphone mode:
1. Click Microphone and allow browser access to your microphone.
2. The incoming signal is shown immediately in the live spectrum. Microphone audio is not played through your speakers.
3. Switch back to Audio file to stop the microphone.

In both modes:
• Pink tilt compensates the standard −3.01 dB-per-octave slope by default: higher octaves receive +3.01 dB/oct and the graph is normalized again. Use Pink tilt to compare compensated and raw spectra.
• Semi-transparent white vertical gradients show the individual spectrum peaks currently considered note candidates by the detector.
• Sensitivity controls detector strictness from −100% to +100%. Negative values are stricter than the former zero position; positive values admit quieter and less prominent peaks.
• Detect selects the pitch classes of the shown candidates. The same note is then highlighted in every octave on the keyboard, so there can be more highlighted physical keys than vertical lines.
• The Note audition control in the header turns the sine tone on or off and sets its level.
• Hold a note area on the spectrum, or hold a key on the Keys keyboard, to hear that note's sine tone.


Customizing the interface
-------------------------
• Hold a Keys, Guitar, Scales, Camelot, or Audio tab and drag it.
• Dropping in the center of another panel combines panels into tabs.
• Dropping at an edge places the panel above, below, left, or right.
• Drag the dividers between panels to change their width or height.
• The layout is saved automatically in the browser.
• Reset layout restores the original layout.


Troubleshooting
---------------
• If an audio file does not open, try WAV or MP3, or use another current browser.
• If the microphone does not start, allow it in browser or macOS settings and try again.
• If the interface is in an inconvenient state, click Reset layout.
• Audio files must be selected again after the page is closed or reloaded.


Folder contents
---------------
• ScaleScope.html — the fully standalone application.
• README.txt — this guide.

You can copy the complete folder to another computer or send it as an archive.
