// --- 1. Firebase Auth and Initialization ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signInAnonymously,
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    doc, 
    addDoc, 
    setDoc, 
    deleteDoc, 
    updateDoc,
    onSnapshot, 
    query, 
    orderBy,
    writeBatch,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// Your Firebase configuration object (Dashboard)
const firebaseConfig = {
  apiKey: "AIzaSyCuo69DgYtxCdVRmRvziVfnS69koYMGJ0E",
  authDomain: "dashboard-1fb59.firebaseapp.com",
  projectId: "dashboard-1fb59",
  storageBucket: "dashboard-1fb59.firebasestorage.app",
  messagingSenderId: "576174466807",
  appId: "1:576174466807:web:eef62f64e35b69560815f2",
  measurementId: "G-213LH7WH40"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Use global app ID if available (for the schedule artifacts path)
const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Global variables for Firestore ---
let currentUserId = null;
let tasksCollectionRef = null;
let tasksUnsubscribe = null;
let addressesCollectionRef = null;
let addressesUnsubscribe = null;
let unitStatusCollectionRef = null;
let unitStatusUnsubscribe = null;
let maintenanceCollectionRef = null;
let maintenanceUnsubscribe = null;
let tickerUnsubscribe = null;
let layoutUnsubscribe = null; 
let scheduleUnsubscribe = null;

// Global variables for Schedule Logic
let importedShifts = [];
let existingShifts = [];

// --- INACTIVITY TIMER SETTINGS ---
let inactivityTimeout;
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 Minutes

// --- ROUTER LOGIC ---
window.Router = {
    current: 'dashboard',
    navigate: function(viewId) {
        // Hide all views
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active')); 
        
        // Deselect nav
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.remove('active', 'border-indigo-600', 'text-indigo-600', 'bg-indigo-50');
            el.classList.add('border-transparent', 'text-gray-600');
        });

        // Show target
        const targetView = document.getElementById(`view-${viewId}`);
        if(targetView) {
            targetView.classList.remove('hidden');
            setTimeout(() => targetView.classList.add('active'), 10);
        }

        // Highlight Nav
        const navLink = document.getElementById(`nav-${viewId}`);
        if(navLink) {
            navLink.classList.remove('border-transparent', 'text-gray-600');
            navLink.classList.add('active', 'border-indigo-600', 'text-indigo-600', 'bg-indigo-50');
        }

        this.current = viewId;
        
        // Mobile Menu Logic
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
        
        if(window.innerWidth >= 768) {
            sidebar.classList.remove('-translate-x-full', 'translate-x-0');
        }
    }
};

// Mobile Menu Toggles
document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.add('translate-x-0');
    overlay.classList.remove('hidden');
});
document.getElementById('sidebarOverlay').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.add('-translate-x-full');
    sidebar.classList.remove('translate-x-0');
    overlay.classList.add('hidden');
});

// --- HELPER FUNCTIONS ---
function formatFirestoreTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        const date = timestamp.toDate();
        return date.toLocaleString('en-US', {
            year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
        });
    } catch (e) { return 'Invalid Date'; }
}

function setLoading(isLoading, btn, txt, spinner) {
    if (!btn || !txt || !spinner) return;
    btn.disabled = isLoading;
    if (isLoading) {
        txt.style.display = 'none';
        spinner.style.display = 'inline-block';
    } else {
        txt.style.display = 'inline-block';
        spinner.style.display = 'none';
    }
}

function showMessage(box, message, type) {
    if (!box) return;
    box.textContent = message;
    box.className = 'mt-4 text-center text-sm p-3 rounded-lg';
    if (type === 'success') box.classList.add('bg-green-100', 'text-green-800');
    else box.classList.add('bg-red-100', 'text-red-800');
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 5000);
}

// --- INACTIVITY LOGIC ---
function startInactivityTracking() {
    window.addEventListener('mousemove', resetInactivityTimer);
    window.addEventListener('mousedown', resetInactivityTimer);
    window.addEventListener('keypress', resetInactivityTimer);
    window.addEventListener('touchmove', resetInactivityTimer);
    window.addEventListener('scroll', resetInactivityTimer);
    resetInactivityTimer(); // Start initial timer
}

function stopInactivityTracking() {
    window.removeEventListener('mousemove', resetInactivityTimer);
    window.removeEventListener('mousedown', resetInactivityTimer);
    window.removeEventListener('keypress', resetInactivityTimer);
    window.removeEventListener('touchmove', resetInactivityTimer);
    window.removeEventListener('scroll', resetInactivityTimer);
    clearTimeout(inactivityTimeout);
}

function resetInactivityTimer() {
    // If user is already logged out, do nothing
    if (!auth.currentUser) return;

    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
        // Time limit reached
        signOut(auth).then(() => {
            alert("You have been signed out due to inactivity.");
        }).catch((e) => console.error("Sign out error", e));
    }, INACTIVITY_LIMIT_MS);
}

// --- 2. AUTHENTICATION & UI STATE ---
onAuthStateChanged(auth, (user) => {
    const loginView = document.getElementById('login-view');
    const sidebar = document.getElementById('sidebar');
    const mobileHeader = document.getElementById('mobile-header');
    const mainContent = document.getElementById('main-content');
    const userStatus = document.getElementById('userStatus');

    if (user) {
        // Logged In
        currentUserId = user.uid;
        userStatus.textContent = user.email || "Admin User";
        
        loginView.classList.add('login-fade-out'); 
        setTimeout(() => loginView.classList.add('hidden'), 500);
        
        sidebar.classList.remove('hidden');
        sidebar.classList.add('flex');
        mobileHeader.classList.remove('hidden');
        mobileHeader.classList.add('flex');
        mainContent.classList.remove('hidden');
        mainContent.classList.add('flex', 'flex-col'); 

        // Start Listeners
        setupUnitStatusLogic(); 
        setupTaskLogic();
        setupAddressLogic(); 
        setupMaintenanceLogic();
        setupTickerLogic();
        setupRealtimeLayout();
        setupScheduleLogic();
        fetchPosts();
        
        // Start Inactivity Timer
        startInactivityTracking();
        
    } else {
        // Logged Out
        currentUserId = null;
        
        loginView.classList.remove('hidden', 'login-fade-out');
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex');
        mobileHeader.classList.add('hidden');
        mobileHeader.classList.remove('flex');
        mainContent.classList.add('hidden');

        // Stop Listeners
        if(tasksUnsubscribe) tasksUnsubscribe();
        if(addressesUnsubscribe) addressesUnsubscribe();
        if(unitStatusUnsubscribe) unitStatusUnsubscribe();
        if(maintenanceUnsubscribe) maintenanceUnsubscribe();
        if(tickerUnsubscribe) tickerUnsubscribe();
        if(layoutUnsubscribe) layoutUnsubscribe();
        if(scheduleUnsubscribe) scheduleUnsubscribe();
        
        // Stop Inactivity Timer
        stopInactivityTracking();
    }
});

// Login Form
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;
    const errBox = document.getElementById('login-error');
    
    errBox.classList.add('hidden');
    
    signInWithEmailAndPassword(auth, email, password)
        .catch((error) => {
            console.error(error);
            errBox.classList.remove('hidden');
        });
});

// Sign Out
document.getElementById('sign-out-button').addEventListener('click', () => {
    signOut(auth);
});

// --- REAL-TIME LAYOUT SYSTEM ---
function setupRealtimeLayout() {
    const collectionRef = collection(db, 'layout_settings');
    layoutUnsubscribe = onSnapshot(collectionRef, (snapshot) => {
        snapshot.forEach(docSnap => {
            const containerId = docSnap.id;
            const data = docSnap.data();
            const el = document.getElementById(containerId);

            if (el) {
                const cleanClasses = (cls) => {
                    const prefixes = ['w-', 'grid-cols-', 'gap-'];
                    const bpPrefixes = ['md:', 'lg:', 'xl:'];
                    let keep = true;
                    prefixes.forEach(p => { if (cls.startsWith(p)) keep = false; bpPrefixes.forEach(bp => { if (cls.startsWith(bp + p)) keep = false; }); });
                    return keep;
                };
                
                el.className = el.className.split(' ').filter(cleanClasses).join(' ');

                let newClasses = ['grid']; 

                if (data.fullConfig) {
                    const { base, md, lg, xl } = data.fullConfig;
                    if(base) newClasses.push(base.width, base.cols, base.gap);
                    if(md) newClasses.push(`md:${md.width}`, `md:${md.cols}`, `md:${md.gap}`);
                    if(lg) newClasses.push(`lg:${lg.width}`, `lg:${lg.cols}`, `lg:${lg.gap}`);
                    if(xl) newClasses.push(`xl:${xl.width}`, `xl:${xl.cols}`, `xl:${xl.gap}`);
                } else {
                    if(data.width) newClasses.push(data.width);
                    if(data.cols) newClasses.push(data.cols);
                    if(data.gap) newClasses.push(data.gap);
                }
                el.className += ' ' + newClasses.join(' ');
            }
        });
    });
}

// --- SCHEDULE LOGIC ---
function setupScheduleLogic() {
    const addForm = document.getElementById('add-shift-form');
    const editForm = document.getElementById('edit-form-schedule');
    const groupsContainer = document.getElementById('schedule-groups');
    
    // Listen for Realtime Shifts
    const q = collection(db, 'artifacts', globalAppId, 'public', 'data', 'emsSchedule');
    scheduleUnsubscribe = onSnapshot(q, (snapshot) => {
        const shifts = [];
        snapshot.forEach(doc => shifts.push({ id: doc.id, ...doc.data() }));
        
        // Cache for dup check
        existingShifts = shifts;

        // Group Shifts by Month-Year
        const groups = {};
        shifts.forEach(shift => {
            if(!shift.date) return;
            const [y, m, d] = shift.date.split('-');
            const sortKey = `${y}-${m}`; // Key for sorting groups (2025-12)
            
            // Generate readable title (December 2025)
            // Note: Date(y, m-1) is local time, which is fine for just getting the month name
            const dateObj = new Date(parseInt(y), parseInt(m)-1, 1);
            const title = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

            if(!groups[sortKey]) groups[sortKey] = { title: title, shifts: [] };
            groups[sortKey].shifts.push(shift);
        });

        // Sort Groups Descending (Newest Month First)
        const sortedKeys = Object.keys(groups).sort().reverse();

        if (groupsContainer) {
            if (shifts.length === 0) {
                groupsContainer.innerHTML = '<div class="text-center text-gray-400 py-8 text-sm">No shifts found.</div>';
            } else {
                groupsContainer.innerHTML = sortedKeys.map((key, index) => {
                    const group = groups[key];
                    // Sort shifts within group: Descending by date/time
                    group.shifts.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

                    // First group open by default
                    const isOpen = index === 0;
                    const displayClass = isOpen ? 'block' : 'hidden';
                    const iconClass = isOpen ? 'fa-chevron-up' : 'fa-chevron-down';

                    return `
                        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                            <button onclick="window.toggleScheduleGroup('${key}')" class="w-full flex justify-between items-center p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left border-b border-gray-100">
                                <div class="flex items-center gap-2">
                                    <span class="font-bold text-gray-800 text-sm md:text-base">${group.title}</span>
                                    <span class="text-xs font-normal text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">${group.shifts.length}</span>
                                </div>
                                <i id="icon-${key}" class="fa-solid ${iconClass} text-gray-400 transition-transform"></i>
                            </button>
                            
                            <div id="group-${key}" class="${displayClass}">
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left border-collapse">
                                        <thead class="bg-white text-gray-400 text-[10px] uppercase tracking-wider border-b border-gray-50">
                                            <tr>
                                                <th class="p-3 font-medium w-1/4">Date</th>
                                                <th class="p-3 font-medium">Crew</th>
                                                <th class="p-3 font-medium text-right w-16"></th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-gray-50 text-sm">
                                            ${group.shifts.map(shift => `
                                                <tr onclick="window.openEditScheduleModal('${shift.id}', '${shift.date}', '${shift.time}', '${shift.crewMember1}', '${shift.crewMember2}', '${shift.trainee || ''}')" class="hover:bg-indigo-50/50 transition-colors cursor-pointer group">
                                                    <td class="p-3 align-top">
                                                        <div class="font-bold text-gray-700">${formatDateUS(shift.date)}</div>
                                                        <div class="text-xs text-gray-400 mt-0.5">${shift.time}</div>
                                                    </td>
                                                    <td class="p-3 align-top">
                                                        <div class="text-gray-700 text-sm space-y-1">
                                                            <div class="flex items-start gap-2">
                                                                <span class="text-[10px] uppercase font-bold text-gray-300 w-3 pt-0.5">1</span>
                                                                <span>${shift.crewMember1}</span>
                                                            </div>
                                                            <div class="flex items-start gap-2">
                                                                <span class="text-[10px] uppercase font-bold text-gray-300 w-3 pt-0.5">2</span>
                                                                <span>${shift.crewMember2}</span>
                                                            </div>
                                                        </div>
                                                        ${shift.trainee ? `<div class="text-xs text-indigo-600 mt-1 pl-5">w/ ${shift.trainee}</div>` : ''}
                                                    </td>
                                                    <td class="p-3 text-right align-middle">
                                                        <button onclick="event.stopPropagation(); window.deleteShift('${shift.id}')" class="text-gray-300 hover:text-red-500 p-2 rounded transition-colors" title="Delete Shift">
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    });

    // Add Shift Submit
    if(addForm) {
        addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = addForm.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            const shiftData = {
                date: document.getElementById('add-date').value,
                time: document.getElementById('add-time').value,
                crewMember1: document.getElementById('add-crew1').value,
                crewMember2: document.getElementById('add-crew2').value,
                trainee: document.getElementById('add-trainee').value
            };
            try {
                await addDoc(collection(db, 'artifacts', globalAppId, 'public', 'data', 'emsSchedule'), shiftData);
                addForm.reset();
                showMessage(document.getElementById('message-box-schedule'), 'Shift added successfully.', 'success');
            } catch (error) {
                console.error("Error saving:", error);
                showMessage(document.getElementById('message-box-schedule'), 'Error adding shift.', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Create Shift';
            }
        });
    }

    // Edit Shift Submit
    if(editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const docId = document.getElementById('edit-doc-id').value;
            const shiftData = {
                date: document.getElementById('edit-date').value,
                time: document.getElementById('edit-time').value,
                crewMember1: document.getElementById('edit-crew1').value,
                crewMember2: document.getElementById('edit-crew2').value,
                trainee: document.getElementById('edit-trainee').value
            };
            try {
                await updateDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'emsSchedule', docId), shiftData);
                document.getElementById('edit-schedule-modal').classList.remove('flex');
                document.getElementById('edit-schedule-modal').classList.add('hidden');
            } catch (error) {
                console.error("Error updating:", error);
                alert("Error updating shift.");
            }
        });
    }

    // Text Import Listeners
    document.getElementById('open-text-import').addEventListener('click', () => {
        document.getElementById('text-modal').classList.remove('hidden');
        document.getElementById('text-modal').classList.add('flex');
    });

    document.getElementById('close-text-modal').addEventListener('click', () => {
        document.getElementById('text-modal').classList.add('hidden');
        document.getElementById('text-modal').classList.remove('flex');
    });

    document.getElementById('process-text-btn').addEventListener('click', () => {
        const rawText = document.getElementById('raw-text-input').value;
        parseRawText(rawText);
        document.getElementById('text-modal').classList.add('hidden');
        document.getElementById('text-modal').classList.remove('flex');
    });

    document.getElementById('close-import-modal').addEventListener('click', () => { 
        document.getElementById('import-modal').classList.add('hidden'); 
        document.getElementById('import-modal').classList.remove('flex'); 
    });
    
    document.getElementById('cancel-import').addEventListener('click', () => { 
        document.getElementById('import-modal').classList.add('hidden'); 
        document.getElementById('import-modal').classList.remove('flex'); 
    });

    document.getElementById('confirm-import').addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('.import-check:checked');
        const batch = writeBatch(db);
        const colRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'emsSchedule');
        let count = 0;
        let updatedCount = 0;
        
        checkboxes.forEach(cb => {
            const index = parseInt(cb.dataset.index);
            const shiftData = importedShifts[index];
            
            const existingEntry = existingShifts.find(s => s.date === shiftData.date && s.time === shiftData.time);

            if (existingEntry) {
                const docRef = doc(colRef, existingEntry.id);
                batch.update(docRef, {
                    crewMember1: shiftData.crew[0] || 'OPEN SHIFT',
                    crewMember2: shiftData.crew[1] || 'OPEN SHIFT',
                    trainee: shiftData.crew[2] || '' 
                });
                updatedCount++;
            } else {
                const docRef = doc(colRef);
                batch.set(docRef, {
                    date: shiftData.date,
                    time: shiftData.time,
                    crewMember1: shiftData.crew[0] || 'OPEN SHIFT',
                    crewMember2: shiftData.crew[1] || 'OPEN SHIFT',
                    trainee: shiftData.crew[2] || '' 
                });
                count++;
            }
        });

        if (count > 0 || updatedCount > 0) {
            try {
                await batch.commit();
                alert(`Success! Created ${count} new shifts. Updated ${updatedCount} existing shifts.`);
                document.getElementById('import-modal').classList.add('hidden');
                document.getElementById('import-modal').classList.remove('flex');
            } catch (e) { console.error(e); alert("Error committing to database."); }
        } else { alert("No shifts selected."); }
    });
}

// --- SCHEDULE HELPERS ---
// Toggle Function for Schedule Groups
window.toggleScheduleGroup = (key) => {
    const content = document.getElementById(`group-${key}`);
    const icon = document.getElementById(`icon-${key}`);
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        content.classList.add('block');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    } else {
        content.classList.add('hidden');
        content.classList.remove('block');
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
    }
};

window.openEditScheduleModal = (id, date, time, c1, c2, trainee) => {
    document.getElementById('edit-doc-id').value = id;
    document.getElementById('edit-date').value = date;
    document.getElementById('edit-time').value = time;
    document.getElementById('edit-crew1').value = c1;
    document.getElementById('edit-crew2').value = c2;
    document.getElementById('edit-trainee').value = trainee || '';
    
    const m = document.getElementById('edit-schedule-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
};

document.getElementById('close-edit-schedule-modal').addEventListener('click', () => {
    const m = document.getElementById('edit-schedule-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
});

window.deleteShift = async (id) => {
    if(confirm('Are you sure you want to delete this shift?')) {
        try {
            await deleteDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'emsSchedule', id));
        } catch (e) { alert('Error deleting: ' + e.message); }
    }
};

const formatDateUS = (val) => {
    if (!val) return '';
    const parts = val.split('-');
    if (parts.length !== 3) return val;
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
};

// --- SCHEDULE TEXT PARSING ---
const NON_NAMES = [
    'medic', 'emt', 'driver', 'day', 'night', 'shift', 'volunteer', 'trainee', 
    'of', 'time', 'starts', 'following', 'calendar', 'events', 'split', 
    'lieutenant', 'captain', 'chief', 'station', 'fire', 'dept', 'township',
    'red', 'asterisk', 'ffemt', 'ff'
];

function parseRawText(text) {
    const lines = text.split('\n');
    
    // UPDATED: Initialize with current date context to support correct rollover detection
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    
    let currentDateStr = null;
    let detectedShifts = [];

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;

        // NEW: Detect "Month Year" header (e.g. "January 2026", "Jan 2026", "Dec 2025")
        // Checks for Month followed by 4-digit Year, allowing optional comma or space
        const headerMatch = trimmed.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(\d{4})/i);
        if (headerMatch) {
             const m = headerMatch[1].toLowerCase().substring(0, 3);
             const y = parseInt(headerMatch[2]);
             
             const months = {
                 jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                 jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
             };
             
             if (months[m]) {
                 currentMonth = months[m];
                 currentYear = y;
                 // It's a header line, so we can return to skip trying to parse this as a day/shift line
                 return;
             }
        }

        const dateMatch = trimmed.match(/^(Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov)?\s*(\d{1,2})$/i);
        if (dateMatch) {
            if (dateMatch[1]) {
                 const m = dateMatch[1].toLowerCase();
                 // Map month abbreviations to their two-digit number strings
                 const months = {
                     jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                     jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
                 };
                 if (months[m]) {
                     const newMonth = months[m];
                     
                     // AUTOMATIC YEAR ROLLOVER
                     // If we are transitioning from December (12) to January (01), increment year
                     if (currentMonth === '12' && newMonth === '01') {
                         currentYear++;
                     }
                     
                     currentMonth = newMonth;
                 }
            }
            const day = dateMatch[2];
            currentDateStr = `${currentYear}-${currentMonth}-${day.padStart(2, '0')}`;
            return;
        }

        const shiftRegex = /([^\d]+?)(\d{2}-\d{2})/g;
        let match;
        while ((match = shiftRegex.exec(trimmed)) !== null) {
            if (!currentDateStr) continue;

            let rawName = match[1];
            const rawTime = match[2];
            let formattedTime = `${rawTime.split('-')[0]}:00 - ${rawTime.split('-')[1]}:00`;
            let isMcOnCall = false;

            // --- ON-CALL LOGIC START ---
            if (currentDateStr) {
                const [y, m, d] = currentDateStr.split('-').map(Number);
                const dt = new Date(y, m - 1, d);
                const day = dt.getDay(); // 0=Sun, 6=Sat
                
                const startH = parseInt(rawTime.split('-')[0], 10);
                
                // Determine if this shift starts during the "ON-CALL" windows:
                // Weekdays: 16:00 to 08:00 (Includes late night starts like 02:00)
                // Weekends: 18:00 to 08:00 (Includes late night starts like 02:00)
                
                const isWeekday = (day >= 1 && day <= 5);
                const isWeekend = (day === 0 || day === 6);
                const isLateNight = (startH < 6); // Covers shifts starting at 00:00 - 05:00

                // Weekday Logic: Starts >= 16:00 OR is a late night continuation
                if (isWeekday && (startH >= 16 || isLateNight)) {
                     isMcOnCall = true;
                }
                // Weekend Logic: Starts >= 18:00 OR is a late night continuation
                else if (isWeekend && (startH >= 18 || isLateNight)) {
                     isMcOnCall = true;
                }
            }
            // --- ON-CALL LOGIC END ---

            let cleanedName = rawName.replace(/Red Asterisk/gi, '').replace(/\*/g, '').trim();
            const cleanNameCheck = cleanedName.replace(/[^a-zA-Z]/g, '').toLowerCase();
            const isRoleOnly = NON_NAMES.includes(cleanNameCheck);
            const hasLetters = /[a-zA-Z]/.test(cleanedName);

            if (!isRoleOnly && hasLetters && cleanedName.length > 2) {
                if (isMcOnCall) {
                    // Group all ON-CALL shifts together by using a generic time label
                    // Append specific time to the name
                    detectedShifts.push({
                        date: currentDateStr,
                        time: "ON-CALL", 
                        crew: `${cleanedName} (${formattedTime})` 
                    });
                } else {
                    // Standard shifts keep their specific time and just the name
                    detectedShifts.push({
                        date: currentDateStr,
                        time: formattedTime,
                        crew: cleanedName 
                    });
                }
            }
        }
    });

    showImportModal(detectedShifts);
}

function showImportModal(shifts) {
    const groupedMap = new Map();
    shifts.forEach(s => {
        const key = `${s.date}|${s.time}`;
        if (!groupedMap.has(key)) {
            groupedMap.set(key, { 
                date: s.date, 
                time: s.time, 
                crew: [] 
            });
        }
        if(!groupedMap.get(key).crew.includes(s.crew)){
            groupedMap.get(key).crew.push(s.crew);
        }
    });
    
    importedShifts = Array.from(groupedMap.values());

    // Apply "Harmony Twp Coverage" Rule: If one slot is Harmony, both should be.
    importedShifts.forEach(shift => {
        const hasHarmony = shift.crew.some(name => name.toLowerCase().includes("harmony twp coverage"));
        if (hasHarmony) {
            shift.crew = ["Harmony Twp Coverage", "Harmony Twp Coverage"];
        }
    });

    const previewContainer = document.getElementById('import-preview');
    const importCount = document.getElementById('import-count');

    previewContainer.innerHTML = '';
    if (importedShifts.length === 0) {
        previewContainer.innerHTML = '<div class="p-4 text-center text-gray-400">No recognizable shifts found in text.</div>';
    } else {
        importedShifts.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        
        importedShifts.forEach((shift, index) => {
            const exists = existingShifts.some(ex => ex.date === shift.date && ex.time === shift.time);
            const statusBadge = exists 
                ? `<span class="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded ml-2 border border-yellow-200">UPDATE</span>`
                : `<span class="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded ml-2 border border-green-200">NEW</span>`;

            const div = document.createElement('div');
            div.className = 'flex items-center gap-3 bg-white p-3 rounded border border-gray-200 shadow-sm';
            div.innerHTML = `
                <input type="checkbox" checked class="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 bg-white import-check" data-index="${index}">
                <div class="flex-1">
                    <div class="font-bold text-gray-800 flex justify-between">
                        <span class="flex items-center">${formatDateUS(shift.date)} ${statusBadge}</span>
                        <span class="text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-medium">${shift.time}</span>
                    </div>
                    <div class="text-sm text-gray-600 mt-1">
                        <span class="text-gray-400 font-medium">Crew:</span> ${shift.crew.join(', ')}
                    </div>
                </div>
            `;
            previewContainer.appendChild(div);
        });
    }
    
    importCount.textContent = document.querySelectorAll('.import-check:checked').length;
    
    previewContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('import-check')) {
            importCount.textContent = document.querySelectorAll('.import-check:checked').length;
        }
    });

    const m = document.getElementById('import-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
}

// --- NEWS FEED LOGIC ---
const MASTER_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyeXvTXB6A7XiTyK4GI0C_G7M42RCacfDvBCtf-AQ-whJFFERrlTo5OIahHXoA30P4O/exec';

document.addEventListener('DOMContentLoaded', () => {
    const newsForm = document.querySelector('#view-news #data-form');
    if(newsForm) {
        newsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = newsForm.querySelector('button[type="submit"]');
            const txt = btn.querySelector('span');
            const ldr = btn.querySelector('div');
            
            setLoading(true, btn, txt, ldr);
            
            const formData = new FormData(newsForm);
            const dataObject = Object.fromEntries(formData.entries());
            dataObject.action = 'addPost';

            fetch(MASTER_WEB_APP_URL, { 
                method: 'POST', body: JSON.stringify(dataObject),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }
            })
            .then(res => res.json())
            .then(data => {
                if(data.status === 'success') {
                    showMessage(document.getElementById('message-box-news'), 'Post published!', 'success');
                    newsForm.reset();
                    fetchPosts();
                } else throw new Error(data.message);
            })
            .catch(err => showMessage(document.getElementById('message-box-news'), err.message, 'error'))
            .finally(() => setLoading(false, btn, txt, ldr));
        });
    }

    document.getElementById('refresh-posts-button').addEventListener('click', fetchPosts);
});

async function fetchPosts() {
    const container = document.getElementById('existing-posts-container');
    const msgArea = document.getElementById('posts-message-area');
    const btnIcon = document.getElementById('refresh-icon');
    
    if(!container) return; 

    btnIcon.classList.add('fa-spin'); 
    container.innerHTML = '';
    
    try {
        const response = await fetch(MASTER_WEB_APP_URL, {
            method: 'POST', body: JSON.stringify({ action: 'getPosts' }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const result = await response.json();
        
        if (result.status === 'success' && result.data.length > 0) {
            msgArea.classList.add('hidden');
            result.data.forEach(post => {
                const card = document.createElement('div');
                card.className = 'p-4 border border-gray-100 rounded-lg shadow-sm bg-white hover:shadow-md transition';
                card.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="text-base font-bold text-gray-900">${post.title}</h3>
                            <p class="text-xs text-gray-500 mt-1">
                                <i class="fa-solid fa-user mr-1"></i> ${post.postedBy} 
                                <span class="mx-2">•</span> 
                                <i class="fa-solid fa-users mr-1"></i> ${post.appliesTo}
                            </p>
                        </div>
                        <div class="flex space-x-2">
                             <button class="edit-post-btn text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
                             <button class="delete-post-btn text-gray-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <p class="text-sm text-gray-700 mt-3 whitespace-pre-wrap">${post.description}</p>
                    <div class="mt-4 pt-3 border-t border-gray-50 flex flex-wrap gap-4 text-xs text-gray-400">
                        <span><i class="fa-solid fa-location-dot mr-1"></i> ${post.location}</span>
                        <span><i class="fa-regular fa-clock mr-1"></i> Post: ${formatSheetDate(post.postDate)}</span>
                        ${post.removeDate ? `<span><i class="fa-solid fa-calendar-xmark mr-1"></i> Ends: ${formatSheetDate(post.removeDate, false)}</span>` : ''}
                    </div>
                `;
                
                const delBtn = card.querySelector('.delete-post-btn');
                delBtn.addEventListener('click', () => handleDeletePost(post.rowId, delBtn));
                
                const editBtn = card.querySelector('.edit-post-btn');
                editBtn.addEventListener('click', () => showEditModal(post));
                
                container.appendChild(card);
            });
        } else {
            msgArea.textContent = 'No active posts found.';
            msgArea.classList.remove('hidden');
        }
    } catch(e) { console.error(e); }
    finally { btnIcon.classList.remove('fa-spin'); }
}

async function handleDeletePost(rowId, btn) {
    if(!confirm('Are you sure you want to delete this post?')) return;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
        await fetch(MASTER_WEB_APP_URL, {
            method: 'POST', body: JSON.stringify({ action: 'deletePost', rowId }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        fetchPosts();
    } catch(e) { alert(e.message); btn.innerHTML = '<i class="fa-solid fa-trash"></i>'; }
}

// Edit Modal Logic (News)
const editModal = document.getElementById('edit-post-modal');
const editForm = document.getElementById('edit-form');

function showEditModal(post) {
    editForm.querySelector('#edit-row-id').value = post.rowId;
    editForm.querySelector('#edit-title').value = post.title;
    editForm.querySelector('#edit-description').value = post.description;
    editForm.querySelector('#edit-location-news').value = post.location;
    editForm.querySelector('#edit-applies-to').value = post.appliesTo;
    editForm.querySelector('#edit-posted-by').value = post.postedBy;
    editForm.querySelector('#edit-post-date').value = convertISOToDateTimeLocal(post.postDate);
    editForm.querySelector('#edit-remove-date').value = post.removeDate ? convertISOToDate(post.removeDate) : '';
    
    editModal.style.display = 'block';
}

document.querySelectorAll('.modal-close, #edit-cancel-button').forEach(el => {
    el.addEventListener('click', () => editModal.style.display = 'none');
});

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('edit-save-button');
    const originalText = btn.innerText;
    btn.innerText = 'Saving...';
    btn.disabled = true;

    const formData = new FormData(editForm);
    const data = Object.fromEntries(formData.entries());

    try {
        await fetch(MASTER_WEB_APP_URL, {
            method: 'POST', body: JSON.stringify({ action: 'updatePost', rowId: data.rowId, data }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        editModal.style.display = 'none';
        fetchPosts();
    } catch(e) { alert(e.message); }
    finally { btn.innerText = originalText; btn.disabled = false; }
});


// --- TICKER FEED LOGIC ---
function setupTickerLogic() {
    const form = document.getElementById('dataForm-ticker');
    const container = document.getElementById('existing-tickers-container');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        btn.disabled = true; btn.textContent = 'Saving...';
        
        try {
            await addDoc(collection(db, 'ticker'), {
                startDateTime: form.startDateTime.value,
                endDateTime: form.endDateTime.value,
                message: form.message.value,
                createdAt: new Date().toISOString()
            });
            form.reset();
            showMessage(document.getElementById('responseMessage-ticker'), 'Ticker added!', 'success');
        } catch(e) {
            showMessage(document.getElementById('responseMessage-ticker'), e.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Add to Ticker';
        }
    });

    const q = query(collection(db, 'ticker'), orderBy('startDateTime', 'desc'));
    tickerUnsubscribe = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if(snapshot.empty) {
            container.innerHTML = '<p class="text-center text-gray-400 text-sm p-4">No active tickers.</p>';
            return;
        }
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const div = document.createElement('div');
            div.className = 'bg-white border border-gray-100 rounded-lg p-4 shadow-sm flex justify-between items-center hover:shadow-md transition';
            div.innerHTML = `
                <div>
                    <p class="font-bold text-gray-800 text-sm">${data.message}</p>
                    <p class="text-xs text-gray-500 mt-1">
                        <i class="fa-regular fa-clock mr-1"></i> ${new Date(data.startDateTime).toLocaleString()} - ${new Date(data.endDateTime).toLocaleString()}
                    </p>
                </div>
                <button class="delete-ticker text-gray-300 hover:text-red-600 transition p-2" data-id="${docSnap.id}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            `;
            container.appendChild(div);
        });

        document.querySelectorAll('.delete-ticker').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(confirm('Delete this ticker?')) {
                    await deleteDoc(doc(db, 'ticker', e.currentTarget.dataset.id));
                }
            });
        });
    });
}


// --- UNIT STATUS LOGIC ---
function setupUnitStatusLogic() {
    unitStatusCollectionRef = collection(db, 'unitStatus');
    const form = document.querySelector('#view-units #update-form');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        setLoading(true, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner'));
        
        try {
            const fd = new FormData(form);
            const unitId = fd.get('unit');
            await setDoc(doc(db, 'unitStatus', unitId), {
                unit: unitId,
                status: fd.get('status'),
                location: fd.get('location'),
                comments: fd.get('comments'),
                reported: serverTimestamp()
            });
            showMessage(document.getElementById('message-box-unit'), 'Unit updated.', 'success');
            form.reset();
        } catch(e) { showMessage(document.getElementById('message-box-unit'), e.message, 'error'); }
        finally { setLoading(false, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner')); }
    });

    unitStatusUnsubscribe = onSnapshot(query(unitStatusCollectionRef), (snap) => {
        const container = document.getElementById('unit-status-container');
        container.innerHTML = '';
        
        if(snap.empty) {
            document.getElementById('status-message-area').textContent = 'No unit data.';
            return;
        }

        const units = [];
        snap.forEach(d => units.push(d.data()));
        units.sort((a,b) => a.unit.localeCompare(b.unit));

        units.forEach(u => {
            let color = 'text-gray-700 bg-gray-100';
            if(u.status === 'In Service') color = 'text-green-800 bg-green-100';
            else if(u.status === 'OOS') color = 'text-red-800 bg-red-100';
            else if(u.status === 'Limited Service') color = 'text-yellow-800 bg-yellow-100';

            container.innerHTML += `
                <div class="p-4 border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col justify-between">
                    <div>
                        <div class="flex justify-between items-start mb-2">
                            <h3 class="font-bold text-gray-900">${u.unit}</h3>
                            <span class="text-xs font-bold px-2 py-1 rounded-full ${color}">${u.status}</span>
                        </div>
                        <p class="text-sm text-gray-600"><span class="font-semibold">Loc:</span> ${u.location}</p>
                        <p class="text-sm text-gray-500 italic mt-1">"${u.comments || '-'}"</p>
                    </div>
                    <p class="text-xs text-gray-400 mt-3 pt-2 border-t text-right">Updated: ${formatFirestoreTimestamp(u.reported)}</p>
                </div>
            `;
        });
    });
}

// --- TASKS LOGIC ---
function setupTaskLogic() {
    tasksCollectionRef = collection(db, 'dailyTasks');
    const form = document.querySelector('#view-tasks #task-form');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        setLoading(true, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner'));

        try {
            const days = [];
            form.querySelectorAll('input[name="task-day"]:checked').forEach(c => days.push(c.value));
            if(!days.length) throw new Error("Select at least one day.");
            
            await addDoc(tasksCollectionRef, {
                task: form.Task.value,
                assignee: form.Assignee.value,
                day: days,
                createdAt: serverTimestamp()
            });
            form.reset();
            showMessage(document.getElementById('message-box-task'), 'Task added.', 'success');
        } catch(e) { showMessage(document.getElementById('message-box-task'), e.message, 'error'); }
        finally { setLoading(false, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner')); }
    });

    tasksUnsubscribe = onSnapshot(query(tasksCollectionRef), (snap) => {
        const container = document.getElementById('existing-tasks-container');
        container.innerHTML = '';
        snap.forEach(d => {
            const t = d.data();
            const div = document.createElement('div');
            div.className = 'p-3 border border-gray-200 rounded-lg shadow-sm bg-white hover:bg-gray-50 transition';
            div.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-gray-800 text-sm">${t.task}</h3>
                    <div class="flex space-x-1">
                        <button class="edit-btn text-blue-500 hover:bg-blue-100 p-1 rounded"><i class="fa-solid fa-pen"></i></button>
                        <button class="del-btn text-gray-400 hover:text-red-600 hover:bg-red-50 p-1 rounded"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="text-xs text-gray-500 mt-2 flex justify-between">
                    <span><i class="fa-solid fa-user mr-1"></i> ${t.assignee}</span>
                    <span class="font-medium text-indigo-600">${Array.isArray(t.day) ? t.day.join(', ') : t.day}</span>
                </div>
            `;
            
            div.querySelector('.del-btn').addEventListener('click', () => deleteDoc(doc(db, 'dailyTasks', d.id)));
            div.querySelector('.edit-btn').addEventListener('click', () => showEditTaskModal(d.id, t));
            
            container.appendChild(div);
        });
    });
}

// Task Edit Modal
const taskModal = document.getElementById('edit-task-modal');
const taskEditForm = document.getElementById('edit-task-form');
let currentTaskEditId = null;

function showEditTaskModal(id, data) {
    currentTaskEditId = id;
    taskEditForm.querySelector('[name="Task"]').value = data.task;
    taskEditForm.querySelector('[name="Assignee"]').value = data.assignee;
    taskEditForm.querySelectorAll('[name="edit-task-day"]').forEach(c => c.checked = false);
    if(Array.isArray(data.day)) {
        data.day.forEach(d => {
            const cb = taskEditForm.querySelector(`[value="${d}"]`);
            if(cb) cb.checked = true;
        });
    }
    taskModal.style.display = 'block';
}

document.querySelector('#task-modal-close-button').onclick = () => taskModal.style.display = 'none';
document.querySelector('#edit-task-cancel-button').onclick = () => taskModal.style.display = 'none';

taskEditForm.onsubmit = async (e) => {
    e.preventDefault();
    const days = [];
    taskEditForm.querySelectorAll('input:checked').forEach(c => days.push(c.value));
    
    await setDoc(doc(db, 'dailyTasks', currentTaskEditId), {
        task: taskEditForm.querySelector('[name="Task"]').value,
        assignee: taskEditForm.querySelector('[name="Assignee"]').value,
        day: days
    }, {merge: true});
    taskModal.style.display = 'none';
};

// --- ADDRESSES LOGIC ---
function setupAddressLogic() {
    addressesCollectionRef = collection(db, 'addressNotes');
    const form = document.querySelector('#view-addresses #contact-form');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        setLoading(true, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner'));
        
        try {
            await addDoc(addressesCollectionRef, {
                address: form.Address.value,
                note: form.Note.value,
                priority: form.Priority.value,
                createdAt: serverTimestamp()
            });
            form.reset();
            showMessage(document.getElementById('status-message-address'), 'Address added.', 'success');
        } catch(e) { showMessage(document.getElementById('status-message-address'), e.message, 'error'); }
        finally { setLoading(false, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner')); }
    });

    addressesUnsubscribe = onSnapshot(query(addressesCollectionRef), (snap) => {
        const container = document.getElementById('existing-addresses-container');
        container.innerHTML = '';
        snap.forEach(d => {
            const a = d.data();
            let color = 'bg-green-100 text-green-800';
            if(a.priority === 'Red') color = 'bg-red-100 text-red-800';
            else if(a.priority === 'Yellow') color = 'bg-yellow-100 text-yellow-800';

            const div = document.createElement('div');
            div.className = 'p-4 border border-gray-200 rounded-lg shadow-sm bg-white hover:shadow-md transition';
            div.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-gray-900">${a.address}</h3>
                    <div class="flex space-x-2">
                        <span class="text-xs px-2 py-1 rounded ${color} font-bold mr-2">${a.priority}</span>
                        <button class="edit-addr text-blue-500 hover:text-blue-700"><i class="fa-solid fa-pen"></i></button>
                        <button class="del-addr text-gray-400 hover:text-red-600"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <p class="text-sm text-gray-600 mt-2">${a.note}</p>
            `;
            div.querySelector('.del-addr').onclick = () => { if(confirm('Delete?')) deleteDoc(doc(db, 'addressNotes', d.id)); };
            div.querySelector('.edit-addr').onclick = () => showEditAddrModal(d.id, a);
            container.appendChild(div);
        });
    });
}

// Edit Address Modal
const addrModal = document.getElementById('edit-address-modal');
const addrForm = document.getElementById('edit-address-form');
let currentAddrId = null;

function showEditAddrModal(id, data) {
    currentAddrId = id;
    addrForm.querySelector('[name="Address"]').value = data.address;
    addrForm.querySelector('[name="Note"]').value = data.note;
    addrForm.querySelector('[name="Priority"]').value = data.priority;
    addrModal.style.display = 'block';
}

document.querySelector('#address-modal-close-button').onclick = () => addrModal.style.display = 'none';
document.querySelector('#edit-address-cancel-button').onclick = () => addrModal.style.display = 'none';

addrForm.onsubmit = async (e) => {
    e.preventDefault();
    await setDoc(doc(db, 'addressNotes', currentAddrId), {
        address: addrForm.querySelector('[name="Address"]').value,
        note: addrForm.querySelector('[name="Note"]').value,
        priority: addrForm.querySelector('[name="Priority"]').value
    }, {merge: true});
    addrModal.style.display = 'none';
};


// --- MAINTENANCE LOGIC ---
function setupMaintenanceLogic() {
    maintenanceCollectionRef = collection(db, 'maintenance');
    const form = document.querySelector('#view-maintenance #maintenance-form');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        setLoading(true, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner'));
        
        try {
            await addDoc(maintenanceCollectionRef, {
                vendor: form.Vendor.value,
                service: form.Service.value,
                location: form.Location.value,
                date: form.Date.value,
                createdAt: serverTimestamp()
            });
            form.reset();
            showMessage(document.getElementById('message-box-maintenance'), 'Entry logged.', 'success');
        } catch(e) { showMessage(document.getElementById('message-box-maintenance'), e.message, 'error'); }
        finally { setLoading(false, btn, btn.querySelector('.button-text'), btn.querySelector('.button-spinner')); }
    });

    maintenanceUnsubscribe = onSnapshot(query(maintenanceCollectionRef), (snap) => {
        const container = document.getElementById('existing-maintenance-container');
        container.innerHTML = '';
        
        const entries = [];
        snap.forEach(d => entries.push({id: d.id, ...d.data()}));
        entries.sort((a,b) => new Date(b.date) - new Date(a.date));

        entries.forEach(m => {
            const div = document.createElement('div');
            div.className = 'p-3 border border-gray-200 rounded-lg shadow-sm bg-white hover:bg-gray-50 transition';
            div.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-gray-800 text-sm">${m.service}</h3>
                    <div class="flex space-x-1">
                        <button class="edit-maint text-blue-500 hover:bg-blue-100 p-1 rounded"><i class="fa-solid fa-pen"></i></button>
                        <button class="del-maint text-gray-400 hover:text-red-600 hover:bg-red-50 p-1 rounded"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="mt-2 text-xs text-gray-500 grid grid-cols-2 gap-2">
                    <span><i class="fa-solid fa-store mr-1"></i> ${m.vendor}</span>
                    <span><i class="fa-solid fa-location-dot mr-1"></i> ${m.location}</span>
                </div>
                <p class="text-xs text-gray-400 mt-2 border-t pt-1"><i class="fa-regular fa-calendar mr-1"></i> ${m.date}</p>
            `;
            div.querySelector('.del-maint').onclick = () => { if(confirm('Delete?')) deleteDoc(doc(db, 'maintenance', m.id)); };
            div.querySelector('.edit-maint').onclick = () => showEditMaintModal(m.id, m);
            container.appendChild(div);
        });
    });
}

// Edit Maintenance Modal
const maintModal = document.getElementById('edit-maintenance-modal');
const maintForm = document.getElementById('edit-maintenance-form');
let currentMaintId = null;

function showEditMaintModal(id, data) {
    currentMaintId = id;
    maintForm.querySelector('[name="Vendor"]').value = data.vendor;
    maintForm.querySelector('[name="Service"]').value = data.service;
    maintForm.querySelector('[name="Location"]').value = data.location;
    maintForm.querySelector('[name="Date"]').value = data.date;
    maintModal.style.display = 'block';
}

document.querySelector('#maintenance-modal-close-button').onclick = () => maintModal.style.display = 'none';
document.querySelector('#edit-maintenance-cancel-button').onclick = () => maintModal.style.display = 'none';

maintForm.onsubmit = async (e) => {
    e.preventDefault();
    await setDoc(doc(db, 'maintenance', currentMaintId), {
        vendor: maintForm.querySelector('[name="Vendor\"]').value,
        service: maintForm.querySelector('[name="Service"]').value,
        location: maintForm.querySelector('[name="Location"]').value,
        date: maintForm.querySelector('[name="Date"]').value
    }, {merge: true});
    maintModal.style.display = 'none';
};

// --- UTILS ---
function convertISOToDate(iso) {
    if(!iso) return '';
    return iso.split('T')[0];
}
function convertISOToDateTimeLocal(iso) {
    if(!iso) return '';
    const d = new Date(iso);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}
function formatSheetDate(iso, time=true) {
    if(!iso) return 'N/A';
    const d = new Date(iso);
    const opt = { year:'numeric', month:'numeric', day:'numeric' };
    if(time) { opt.hour='numeric'; opt.minute='numeric'; }
    return d.toLocaleString('en-US', opt);
}