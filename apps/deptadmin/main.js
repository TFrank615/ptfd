// --- 1. Firebase Auth and Initialization ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    doc, 
    addDoc, 
    setDoc, 
    deleteDoc, 
    updateDoc,
    getDocs,
    getDoc,
    onSnapshot, 
    query, 
    where,
    orderBy,
    writeBatch,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// UPDATED FIREBASE CONFIG (pleasant-fire)
const firebaseConfig = {
  apiKey: "AIzaSyBsaM_8RjTsgaSOPrOkyaK1DXghCHumxkc",
  authDomain: "pleasant-fire.firebaseapp.com",
  projectId: "pleasant-fire",
  storageBucket: "pleasant-fire.firebasestorage.app",
  messagingSenderId: "107375626982",
  appId: "1:107375626982:web:97eed5f81377b15eba8927",
  measurementId: "G-TT4G7K37M2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Use global app ID if available, otherwise default to a static ID for this deployment
const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'pleasant-township-app';

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

// Global variables for Forms Logic
let editingFormId = null;
let targetSectionContainer = null;
let allRecordsCache = [];

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

// FORMAT: MM-DD-YYYY HH:MM
function formatFirestoreTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        const d = timestamp.toDate();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        
        return `${mm}-${dd}-${yyyy} ${hours}:${minutes}`;
    } catch (e) { return 'Invalid Date'; }
}

// FORMAT: MM-DD-YYYY
function formatStandardDate(val) {
    if (!val) return '-';
    
    // If it's a Firestore timestamp object
    if (typeof val === 'object' && typeof val.toDate === 'function') {
        const d = val.toDate();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}-${dd}-${yyyy}`;
    }
    
    // If it's a YYYY-MM-DD string (HTML Date Input Standard)
    const ymdMatch = String(val).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
        return `${ymdMatch[2]}-${ymdMatch[3]}-${ymdMatch[1]}`;
    }

    return val;
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
        setupFormBuilder();
        setupFormRecords();
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
    const collectionRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'layout_settings');
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

/* =========================================
   === FORM BUILDER LOGIC (VISUAL GRID) ===
   ========================================= */

function setupFormBuilder() {
    const sectionsContainer = document.getElementById('builder-sections-container');
    const saveBtn = document.getElementById('save-form-btn');
    const deleteBtn = document.getElementById('delete-form-btn');
    const loadSelect = document.getElementById('existing-forms-select');
    
    // Initialize Sortable for sections
    new Sortable(sectionsContainer, {
        animation: 150,
        handle: '.section-handle',
        ghostClass: 'ghost'
    });

    // Initial Load of Existing Forms
    loadFormList(loadSelect);

    // Load Form Listener
    loadSelect.addEventListener('change', async (e) => {
        const id = e.target.value;
        if (!id) {
            resetFormBuilder();
            return;
        }
        
        try {
            const docSnap = await getDoc(doc(db, "forms", id));
            if (docSnap.exists()) {
                const data = docSnap.data();
                editingFormId = id;
                document.getElementById('builder-form-title').value = data.title;
                deleteBtn.classList.remove('hidden');
                
                // Clear and rebuild
                sectionsContainer.innerHTML = '';
                if(data.structure === 'v2') {
                    data.sections.forEach(sec => {
                        const container = addFormSection(sec.title);
                        sec.fields.forEach(f => addFormField(container, f));
                    });
                }
            }
        } catch(err) { console.error("Error loading form", err); }
    });

    // Save Logic
    saveBtn.addEventListener('click', async () => {
        const title = document.getElementById('builder-form-title').value;
        if(!title) return alert("Title required");
        
        saveBtn.innerText = 'Saving...';

        const sections = [];
        document.querySelectorAll('.builder-section').forEach(secCard => {
            const fields = [];
            secCard.querySelectorAll('.builder-field').forEach(fieldWrap => {
                fields.push({
                    label: fieldWrap.querySelector('.field-label').value,
                    type: fieldWrap.querySelector('.field-type').value,
                    width: fieldWrap.querySelector('.field-width').value,
                    options: fieldWrap.querySelector('.field-options').value,
                    required: fieldWrap.querySelector('.field-required').checked 
                });
            });
            sections.push({ 
                title: secCard.querySelector('.section-title').value, 
                fields: fields 
            });
        });

        const formData = { title, structure: 'v2', sections, updatedAt: new Date() };

        try {
            if (editingFormId) {
                await setDoc(doc(db, "forms", editingFormId), formData, { merge: true });
                alert("Form Updated!");
            } else {
                formData.createdAt = new Date();
                await addDoc(collection(db, "forms"), formData);
                alert("Form Created!");
            }
            loadFormList(loadSelect); // Refresh list
        } catch(e) { console.error(e); alert("Error saving form: " + e.message); }
        finally { saveBtn.innerHTML = '<i class="fa-solid fa-save mr-2"></i> Save Form'; }
    });

    // Delete Logic
    deleteBtn.addEventListener('click', async () => {
        if(editingFormId && confirm("Delete this form entirely?")) {
            await deleteDoc(doc(db, "forms", editingFormId));
            resetFormBuilder();
            loadFormList(loadSelect);
            alert("Deleted.");
        }
    });
}

// Global functions exposed for HTML onlick handlers
window.resetFormBuilder = () => {
    editingFormId = null;
    document.getElementById('builder-form-title').value = '';
    document.getElementById('delete-form-btn').classList.add('hidden');
    document.getElementById('builder-sections-container').innerHTML = '';
    document.getElementById('existing-forms-select').value = '';
};

window.addFormSection = (title = '') => {
    // If container has "Start by adding" placeholder, remove it
    const mainContainer = document.getElementById('builder-sections-container');
    if (mainContainer.children.length === 1 && mainContainer.firstElementChild.classList.contains('text-center')) {
        mainContainer.innerHTML = '';
    }

    const div = document.createElement('div');
    div.className = 'builder-section bg-white border border-gray-200 rounded-xl p-4 shadow-sm';
    div.innerHTML = `
        <div class="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
            <div class="flex items-center gap-2 flex-1">
                <i class="fa-solid fa-grip-vertical text-gray-400 cursor-grab section-handle px-2"></i>
                <input type="text" class="section-title w-full font-bold text-gray-700 bg-transparent border-none focus:ring-0 placeholder-gray-300" 
                       value="${title}" placeholder="Section Title (e.g. Engine Check)">
            </div>
            <button onclick="this.closest('.builder-section').remove()" class="text-gray-300 hover:text-red-500 transition px-2">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
        <div class="fields-container grid grid-cols-12 gap-3 min-h-[50px]"></div>
        <div class="mt-4 pt-2 text-center">
            <button onclick="window.openTypeModal(this)" class="text-sm text-indigo-600 font-medium hover:bg-indigo-50 px-3 py-1 rounded transition">
                <i class="fa-solid fa-plus-circle mr-1"></i> Add Question
            </button>
        </div>
    `;
    mainContainer.appendChild(div);

    // Init Sortable for fields inside this section
    new Sortable(div.querySelector('.fields-container'), {
        animation: 150,
        group: 'shared-fields',
        handle: '.field-handle',
        ghostClass: 'ghost'
    });

    return div.querySelector('.fields-container');
};

window.openTypeModal = (btn) => {
    targetSectionContainer = btn.closest('.builder-section').querySelector('.fields-container');
    const m = document.getElementById('modal-question-type');
    m.classList.remove('hidden');
    m.classList.add('flex');
};

window.confirmAddType = (type) => {
    if(targetSectionContainer) {
        addFormField(targetSectionContainer, { type: type });
    }
    const m = document.getElementById('modal-question-type');
    m.classList.add('hidden');
    m.classList.remove('flex');
};

// Update widths visually
window.updateFieldWidth = (select) => {
    const wrapper = select.closest('.builder-field');
    const val = select.value;
    
    // Remove existing col-span classes
    wrapper.classList.remove('col-span-12', 'col-span-6', 'col-span-4', 'col-span-3');
    
    // Add new
    wrapper.classList.add(`col-span-${val}`);
};

window.addFormField = (container, data = {}) => {
    const div = document.createElement('div');
    
    const width = data.width || 12;
    const type = data.type || 'text';
    const showOptions = type === 'dropdown' ? '' : 'hidden';
    const isRequired = data.required ? 'checked' : ''; 
    
    // Set initial class based on width
    div.className = `builder-field col-span-${width} bg-gray-50 border border-gray-200 rounded-lg p-3 hover:border-indigo-300 transition relative group`;

    div.innerHTML = `
        <div class="flex items-start gap-2 h-full flex-col">
            <div class="flex justify-between w-full items-center mb-1">
                <i class="fa-solid fa-grip-vertical text-gray-400 cursor-grab field-handle"></i>
                <button onclick="this.closest('.builder-field').remove()" class="text-gray-300 hover:text-red-500">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div class="w-full space-y-2 flex-1">
                <input type="text" class="field-label w-full px-2 py-1 bg-white border border-gray-200 rounded text-sm font-semibold focus:ring-1 focus:ring-indigo-500" 
                       placeholder="Question Label" value="${data.label || ''}">
                
                <input type="text" class="field-options w-full px-2 py-1 bg-yellow-50 border border-yellow-200 rounded text-xs text-gray-600 placeholder-gray-400 ${showOptions}" 
                       placeholder="Options (comma separated)" value="${data.options || ''}">
            </div>

            <div class="w-full pt-2 mt-auto border-t border-gray-100 flex flex-wrap gap-2 items-center justify-between">
                <select class="field-type text-[10px] uppercase font-bold text-gray-500 border-none bg-transparent focus:ring-0 p-0" onchange="window.toggleBuilderOptions(this)">
                    <option value="text" ${type === 'text' ? 'selected' : ''}>Text</option>
                    <option value="textarea" ${type === 'textarea' ? 'selected' : ''}>Long Text</option>
                    <option value="number" ${type === 'number' ? 'selected' : ''}>Number</option>
                    <option value="date" ${type === 'date' ? 'selected' : ''}>Date</option>
                    <option value="checkbox" ${type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
                    <option value="dropdown" ${type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
                    <option value="signature" ${type === 'signature' ? 'selected' : ''}>Signature</option>
                </select>

                <div class="flex items-center gap-2">
                    <select class="field-width text-xs border border-gray-200 rounded bg-white py-0.5 pl-1 pr-4 h-6" onchange="window.updateFieldWidth(this)">
                        <option value="12" ${width == 12 ? 'selected' : ''}>Full</option>
                        <option value="6" ${width == 6 ? 'selected' : ''}>1/2</option>
                        <option value="4" ${width == 4 ? 'selected' : ''}>1/3</option>
                        <option value="3" ${width == 3 ? 'selected' : ''}>1/4</option>
                    </select>

                    <label class="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer select-none">
                        <input type="checkbox" class="field-required rounded border-gray-300 text-indigo-600 focus:ring-0 h-3 w-3" ${isRequired}>
                        Req
                    </label>
                </div>
            </div>
        </div>
    `;
    container.appendChild(div);
};

window.toggleBuilderOptions = (select) => {
    const input = select.closest('.builder-field').querySelector('.field-options');
    if(select.value === 'dropdown') input.classList.remove('hidden');
    else input.classList.add('hidden');
};

async function loadFormList(selectElement) {
    selectElement.innerHTML = '<option value="">-- Select a form to edit --</option>';
    const snapshot = await getDocs(collection(db, "forms"));
    snapshot.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.innerText = doc.data().title;
        selectElement.appendChild(opt);
    });
}


/* =========================================
   === RECORDS (SUBMISSIONS) LOGIC ===
   ========================================= */

async function setupFormRecords() {
    const filterSelect = document.getElementById('records-filter-select');
    
    // Load Form Titles for Filter
    const formsSnap = await getDocs(collection(db, "forms"));
    formsSnap.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.data().title;
        opt.innerText = doc.data().title;
        filterSelect.appendChild(opt);
    });

    filterSelect.addEventListener('change', (e) => loadFormRecords(e.target.value));

    // Initial Load
    loadFormRecords('all');
}

window.loadFormRecords = async (filterTitle) => {
    const tbody = document.getElementById('records-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">Loading records...</td></tr>';
    
    let q = collection(db, "submissions");
    if(filterTitle !== 'all') {
        q = query(collection(db, "submissions"), where("formTitle", "==", filterTitle));
    } else {
        q = query(collection(db, "submissions"), orderBy("timestamp", "desc"));
    }

    try {
        const snapshot = await getDocs(q);
        tbody.innerHTML = '';
        allRecordsCache = [];

        if(snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">No records found.</td></tr>';
            return;
        }

        snapshot.forEach(doc => {
            const r = doc.data();
            r.id = doc.id;
            allRecordsCache.push(r);
            
            // Format Timestamp
            const dateSubmitted = formatFirestoreTimestamp(r.timestamp);
            
            // === IMPROVED CHECKOFF DATE LOGIC ===
            let rawCheckDate = r.data['Date'] || r.data['Date of Checkoff'] || r.data['Shift Date'];
            
            // If main keys fail, search strictly for any key containing "Date"
            if (!rawCheckDate) {
                const dateKey = Object.keys(r.data).find(k => k.toLowerCase().includes('date') && !k.toLowerCase().includes('time'));
                if(dateKey) rawCheckDate = r.data[dateKey];
            }
            const checkDate = formatStandardDate(rawCheckDate);

            // === IMPROVED SUBMITTED BY LOGIC ===
            const submittedBy = r.data['SUBMITTED BY'] || r.data['Submitted By'] || r.data['submitted by'] || r.data['Name'] || r.data['Officer'] || 'N/A';
            
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition cursor-pointer';
            tr.onclick = () => openRecordDetail(r.id);
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-gray-900">${dateSubmitted}</td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-500">${checkDate}</td>
                <td class="px-6 py-4 whitespace-nowrap"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">${r.formTitle}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-900 font-medium">${submittedBy}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <span class="text-indigo-600 hover:text-indigo-900">View</span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">Error loading records.</td></tr>`;
    }
};

window.openRecordDetail = async (recordId) => {
    const record = allRecordsCache.find(r => r.id === recordId);
    if(!record) return;

    const modal = document.getElementById('modal-record-detail');
    const content = document.getElementById('record-detail-content');
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    content.innerHTML = '<div class="text-center py-10"><i class="fa-solid fa-spinner fa-spin text-2xl text-gray-400"></i></div>';

    let formStructure = null;
    if (record.formSnapshot) formStructure = record.formSnapshot;
    else if(record.formId) {
        try {
            const formDoc = await getDoc(doc(db, "forms", record.formId));
            if(formDoc.exists()) formStructure = formDoc.data();
        } catch(e) { console.log("Could not load form structure", e); }
    }

    let html = `
        <div class="mb-6 border-b border-gray-200 pb-4">
            <h1 class="text-2xl font-bold text-gray-900 uppercase">${record.formTitle}</h1>
            <p class="text-sm text-gray-500 mt-1">Submission ID: <span class="font-mono text-gray-600">${recordId}</span></p>
            <p class="text-sm text-gray-500">Submitted: ${formatFirestoreTimestamp(record.timestamp)}</p>
        </div>
        <div class="space-y-6">
    `;

    let displayedKeys = new Set();

    if (formStructure && formStructure.structure === 'v2') {
        formStructure.sections.forEach(sec => {
            html += `<div class="bg-gray-50 border-l-4 border-indigo-500 px-4 py-2 font-bold text-gray-700 uppercase text-sm tracking-wide mb-3">${sec.title}</div>`;
            html += `<div class="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6">`; 
            
            sec.fields.forEach(field => {
                const val = record.data[field.label];
                displayedKeys.add(field.label);
                
                let displayVal = val;
                if(val === undefined || val === null || val === '') displayVal = '-';
                else if(field.type === 'signature' && val.startsWith('data:image')) {
                    displayVal = `<img src="${val}" class="h-12 border border-gray-200 rounded bg-white mt-1">`;
                }

                // Tailwind width classes mapping
                let colSpan = 'md:col-span-12';
                if(field.width == 6) colSpan = 'md:col-span-6';
                if(field.width == 4) colSpan = 'md:col-span-4';
                if(field.width == 3) colSpan = 'md:col-span-3';

                html += `
                    <div class="${colSpan}">
                        <div class="p-3 bg-white border border-gray-200 rounded h-full">
                            <span class="block text-xs font-bold text-gray-400 uppercase mb-1">${field.label}</span>
                            <div class="text-gray-900 text-sm whitespace-pre-wrap">${displayVal}</div>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        });
    } else {
        // Fallback for flat data or older forms
        html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">`;
        Object.keys(record.data).sort().forEach(key => {
             displayedKeys.add(key);
             html += `
                <div class="p-3 bg-white border border-gray-200 rounded">
                    <span class="block text-xs font-bold text-gray-400 uppercase mb-1">${key}</span>
                    <div class="text-gray-900 text-sm">${record.data[key]}</div>
                </div>
             `;
        });
        html += `</div>`;
    }

    // Check for orphaned keys (data present but not in template)
    const allDataKeys = Object.keys(record.data);
    const orphanKeys = allDataKeys.filter(k => !displayedKeys.has(k));

    if(orphanKeys.length > 0) {
        html += `<div class="mt-8 border-t border-red-200 pt-4">`;
        html += `<h3 class="text-red-600 font-bold uppercase text-xs mb-3">Archived / Extra Data</h3>`;
        html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">`;
        orphanKeys.forEach(key => {
            html += `
                <div class="p-3 bg-red-50 border border-red-100 rounded">
                    <span class="block text-xs font-bold text-red-400 uppercase mb-1">${key}</span>
                    <div class="text-red-900 text-sm">${record.data[key]}</div>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    html += `</div>`; // Close wrapper
    content.innerHTML = html;
};

// --- SCHEDULE LOGIC ---
function setupScheduleLogic() {
    const addForm = document.getElementById('add-shift-form');
    const editForm = document.getElementById('edit-form-schedule');
    const groupsContainer = document.getElementById('schedule-groups');
    
    const q = collection(db, 'artifacts', globalAppId, 'public', 'data', 'emsSchedule');
    scheduleUnsubscribe = onSnapshot(q, (snapshot) => {
        const shifts = [];
        snapshot.forEach(doc => shifts.push({ id: doc.id, ...doc.data() }));
        
        existingShifts = shifts;

        const groups = {};
        shifts.forEach(shift => {
            if(!shift.date) return;
            const [y, m, d] = shift.date.split('-');
            const sortKey = `${y}-${m}`; 
            
            const dateObj = new Date(parseInt(y), parseInt(m)-1, 1);
            const title = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

            if(!groups[sortKey]) groups[sortKey] = { title: title, shifts: [] };
            groups[sortKey].shifts.push(shift);
        });

        const sortedKeys = Object.keys(groups).sort().reverse();

        if (groupsContainer) {
            if (shifts.length === 0) {
                groupsContainer.innerHTML = '<div class="text-center text-gray-400 py-8 text-sm">No shifts found.</div>';
            } else {
                groupsContainer.innerHTML = sortedKeys.map((key, index) => {
                    const group = groups[key];
                    group.shifts.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

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
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    let currentDateStr = null;
    let detectedShifts = [];

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;

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
                 return;
             }
        }

        const dateMatch = trimmed.match(/^(Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov)?\s*(\d{1,2})$/i);
        if (dateMatch) {
            if (dateMatch[1]) {
                 const m = dateMatch[1].toLowerCase();
                 const months = {
                     jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                     jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
                 };
                 if (months[m]) {
                     const newMonth = months[m];
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

            if (currentDateStr) {
                const [y, m, d] = currentDateStr.split('-').map(Number);
                const dt = new Date(y, m - 1, d);
                const day = dt.getDay(); 
                
                const startH = parseInt(rawTime.split('-')[0], 10);
                const isWeekday = (day >= 1 && day <= 5);
                const isWeekend = (day === 0 || day === 6);
                const isLateNight = (startH < 6); 

                if (isWeekday && (startH >= 16 || isLateNight)) { isMcOnCall = true; }
                else if (isWeekend && (startH >= 18 || isLateNight)) { isMcOnCall = true; }
            }

            let cleanedName = rawName.replace(/Red Asterisk/gi, '').replace(/\*/g, '').trim();
            const cleanNameCheck = cleanedName.replace(/[^a-zA-Z]/g, '').toLowerCase();
            const isRoleOnly = NON_NAMES.includes(cleanNameCheck);
            const hasLetters = /[a-zA-Z]/.test(cleanedName);

            if (!isRoleOnly && hasLetters && cleanedName.length > 2) {
                if (isMcOnCall) {
                    detectedShifts.push({
                        date: currentDateStr,
                        time: "ON-CALL", 
                        crew: `${cleanedName} (${formattedTime})` 
                    });
                } else {
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