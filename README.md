# Heart Rate Exercise Tracker

SolidJS + Vite app for any monitor that exposes the standard Bluetooth Heart Rate service.

## Run

```powershell
npm install
npm run dev
```

Open the Vite local URL.

## Check and Build

```powershell
npm run typecheck
npm run build
```

## Use

1. Wear and wake the heart rate monitor.
2. Click **Connect monitor**.
3. Pick the monitor from the browser Bluetooth chooser.
4. Click **Start** to begin a new exercise.
5. Use the same button to pause/resume, and **Stop** to finish the recording.

The graph keeps the full exercise instead of discarding older readings.
Configure the five heart rate zones under the graph; they are saved in browser local storage.
