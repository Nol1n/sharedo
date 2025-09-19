# Sharedo – Group Planner Web App

A minimal full-stack prototype for planning activities with friends: moodboard (ideas), calendar with availability, and group chat.

- Backend: Node.js + Express + Socket.io
- Frontend: React (Vite) + FullCalendar

See the Running section below for setup instructions.

## Features in this MVP
- Register/Login with JWT cookie; simple profile with avatar URL
- Moodboard: add/list ideas with optional image URL and "Schedule this" flow
- Calendar: month view, create events, link ideas, RSVP availability (Yes/No/Maybe)
- Group Chat: real-time via Socket.io

## Running
- Install backend and frontend dependencies
- Start backend server (port 3000)
- Start frontend dev server (port 5173)
- Or build frontend and serve from backend public folder

Refer to the detailed instructions at the bottom of this file.

## How to run

Prereqs: Node.js 18+ and npm installed.

1) Install dependencies
	 - Backend
		 - npm install --prefix server
	 - Frontend
		 - npm install --prefix client

2) Development: run backend and frontend separately
	 - Start backend on port 4000 (recommended to avoid port conflicts):
		 - PORT=4000 npm start --prefix server
	 - In another terminal, start frontend dev server:
		 - npm run dev --prefix client
	 - Open http://localhost:5173

3) Production-like: build frontend and serve via backend
	 - npm run build --prefix client
	 - PORT=4000 npm start --prefix server
	 - Open http://localhost:4000

Environment variables (optional)
 - JWT_SECRET: Secret for signing JWTs
 - CLIENT_ORIGIN: Frontend origin (default http://localhost:5173)
