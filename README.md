# Med Informatics Quiz

Exam practice for TMU Medical Informatics — midterm (weeks 2–8) & final (weeks 10–15).
Question formats match the exam: **multiple choice, fill in the blank, short answer**.

## Usage
Open `index.html` in a browser (no server needed). Each round defaults to 30 random questions.
Progress (seen / wrong questions) is stored in the browser (localStorage).

Shortcuts: `1–4` / `A–D` pick an option, `Enter` / `→` next question, `←` previous.

## Adding / editing questions
1. Edit or add `data/<lecture>.json` (see existing files for the format).
2. For a new lecture (e.g. final topics), declare it in `LECTURES` in `build.py`.
3. Run `python3 build.py` to regenerate `questions.js`.
