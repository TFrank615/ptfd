import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, writeBatch, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- UPDATED CONFIG (pleasant-fire) ---
const firebaseConfig = {
  apiKey: "AIzaSyBsaM_8RjTsgaSOPrOkyaK1DXghCHumxkc",
  authDomain: "pleasant-fire.firebaseapp.com",
  projectId: "pleasant-fire",
  storageBucket: "pleasant-fire.firebasestorage.app",
  messagingSenderId: "107375626982",
  appId: "1:107375626982:web:97eed5f81377b15eba8927",
  measurementId: "G-TT4G7K37M2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Use consistent App ID 'pleasant-township-app'
const appId = 'pleasant-township-app';

// --- State ---
let allCalls = [];
let nextIncidentData = { id: '...', seq: 1, year: new Date().getFullYear() };
let currentUser = null;
let currentStatsYear = new Date().getFullYear(); 

// Sorting and Filtering State
let sortState = { col: 'datetime', asc: false }; // Default: Newest first

let currentConfig = {
    schedules: {},
    noDayCrewDates: [], // Stores specific "No Day Crew" dates
    statsConfig: {
        showNatures: true,
        showAddresses: true,
        showMutual: true,
        showCrew: true,
        showVolDispo: true,
        limit: 5
    }
};

// --- Auth & Init ---
async function initApp() {
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Auth error:", error);
        document.getElementById('connectionStatus').innerHTML = '<span class="text-red-500 uppercase">Auth Error</span>';
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('connectionStatus').innerHTML = '<span class="text-green-500 font-bold uppercase">Online</span>';
        setupRealtimeListener();
        loadConfiguration();
        selectType('EMS');
        setNowDefaults(); // Ensure date/time is set on load
        toggleMutualAid(); // Ensure fields are correctly hidden/not required on load
    }
});

initApp();

// --- UI TOGGLES ---
window.toggleFilterPanel = function() {
    const panel = document.getElementById('filterPanel');
    const btn = document.getElementById('btn-toggle-filter');
    
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        btn.classList.add('bg-gray-600', 'text-white');
        btn.classList.remove('bg-gray-700', 'text-gray-300');
    } else {
        panel.classList.add('hidden');
        btn.classList.add('bg-gray-700', 'text-gray-300');
        btn.classList.remove('bg-gray-600', 'text-white');
    }
}

window.resetFilters = function() {
    document.getElementById('filterDateStart').value = '';
    document.getElementById('filterDateEnd').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterNature').value = '';
    document.getElementById('filterDisposition').value = '';
    document.getElementById('filterMutual').value = '';
    document.getElementById('filterUnits').value = '';
    document.getElementById('searchInput').value = '';
    renderTable();
}

// --- SORTING ---
window.handleSort = function(col) {
    if (sortState.col === col) {
        // Toggle direction
        sortState.asc = !sortState.asc;
    } else {
        // New column, default to descending for dates/ids, ascending for others
        sortState.col = col;
        sortState.asc = (col === 'incident' || col === 'datetime') ? false : true;
    }
    renderTable();
}

function updateSortIcons() {
    // Reset all icons
    document.querySelectorAll('.sortable .sort-icon').forEach(icon => {
        icon.className = 'fa-solid fa-sort sort-icon';
        icon.parentElement.classList.remove('active-sort');
    });

    // Set active icon
    const th = document.getElementById(`th-${sortState.col}`);
    if (th) {
        th.classList.add('active-sort');
        const icon = th.querySelector('.sort-icon');
        icon.className = sortState.asc ? 'fa-solid fa-sort-up sort-icon' : 'fa-solid fa-sort-down sort-icon';
    }
}

// --- FORCE UPPERCASE HELPER ---
window.forceCaps = function(el) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(start, end);
}

// --- MODAL & EDIT LOGIC ---
window.openEditModal = function(id) {
    const call = allCalls.find(c => c.id === id);
    if (!call) return;

    document.getElementById('edit_docId').value = id;
    document.getElementById('edit_incidentNumber').value = call.incidentNumber || '';
    document.getElementById('edit_dispatchDate').value = call.dispatchDate;
    document.getElementById('edit_dispatchTime').value = call.dispatchTime;
    document.getElementById('edit_callNature').value = call.callNature;
    document.getElementById('edit_address').value = call.address;
    document.getElementById('edit_units').value = call.units || '';
    document.getElementById('edit_notes').value = call.notes || '';
    document.getElementById('edit_emsDisposition').value = call.emsDisposition || '';
    
    selectEditType(call.responseType || 'EMS');

    const maCheckbox = document.getElementById('edit_mutualAid');
    maCheckbox.checked = call.mutualAid || false;
    toggleEditMutualAid();
    
    if (call.mutualAid) {
        document.getElementById('edit_mutualAidType').value = call.mutualAidType;
        handleEditMutualAidTypeChange();
        document.getElementById('edit_mutualAidDept').value = call.mutualAidDept || '';
    }

    document.getElementById('editModal').classList.remove('hidden');
}

window.closeEditModal = function() {
    document.getElementById('editModal').classList.add('hidden');
}

window.saveEdit = async function() {
    const id = document.getElementById('edit_docId').value;
    if(!id) return;

    const timeInput = document.getElementById('edit_dispatchTime');
    validateTime(timeInput);
    if (timeInput.classList.contains('border-red-500')) {
        showToast("INVALID TIME IN EDIT FORM", true);
        return;
    }

    try {
        const isMutualAid = document.getElementById('edit_mutualAid').checked;
        const responseType = document.getElementById('edit_responseType').value;
        const emsDisp = (responseType === 'EMS' || responseType === 'Both') 
            ? document.getElementById('edit_emsDisposition').value 
            : null;
        
        const newIncNum = document.getElementById('edit_incidentNumber').value.toUpperCase();

        let newSeq = null;
        let newYear = null;

        try {
            if (/^\d{2}/.test(newIncNum)) {
                const yearShort = newIncNum.substring(0, 2);
                newYear = 2000 + parseInt(yearShort);
                const match = newIncNum.match(/(\d+)$/);
                if (match) {
                        newSeq = parseInt(match[1]);
                }
            }
        } catch(e) { console.log("Could not parse sequence from new ID", e); }

        const callData = {
            incidentNumber: newIncNum,
            dispatchDate: document.getElementById('edit_dispatchDate').value,
            dispatchTime: document.getElementById('edit_dispatchTime').value,
            callNature: document.getElementById('edit_callNature').value.toUpperCase(),
            responseType: responseType,
            emsDisposition: emsDisp,
            address: document.getElementById('edit_address').value.toUpperCase(),
            units: document.getElementById('edit_units').value.toUpperCase(),
            mutualAid: isMutualAid,
            mutualAidType: isMutualAid ? document.getElementById('edit_mutualAidType').value : null,
            mutualAidDept: isMutualAid ? document.getElementById('edit_mutualAidDept').value.toUpperCase() : null,
            notes: document.getElementById('edit_notes').value.toUpperCase(),
            lastModified: new Date().toISOString(),
            lastModifiedBy: currentUser.uid
        };

        if (newSeq !== null) callData.sequence = newSeq;
        if (newYear !== null) callData.year = newYear;

        const callsRef = doc(db, 'artifacts', appId, 'public', 'data', 'calls', id);
        await updateDoc(callsRef, callData);
        
        closeEditModal();
        showToast(`CALL UPDATED SUCCESSFULLY!`);

    } catch (e) {
        console.error("Update Error:", e);
        showToast("FAILED TO UPDATE CALL", true);
    }
}

// --- EDIT MODAL HELPERS ---
window.selectEditType = function(type) {
    document.getElementById('edit_responseType').value = type;
    
    const btnEms = document.getElementById('edit_btn-ems');
    const btnFire = document.getElementById('edit_btn-fire');
    const btnBoth = document.getElementById('edit_btn-both');
    const dispSection = document.getElementById('edit_emsDispositionSection');
    const baseClass = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700 transition uppercase text-xs";
    
    btnEms.className = baseClass;
    btnFire.className = baseClass;
    btnBoth.className = baseClass;
    
    if(type === 'EMS') {
        btnEms.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-900/50 transform scale-[1.02] transition uppercase text-xs";
        dispSection.classList.remove('hidden');
    } else if (type === 'Fire') {
        btnFire.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-red-500 bg-red-600 text-white shadow-lg shadow-red-900/50 transform scale-[1.02] transition uppercase text-xs";
        dispSection.classList.add('hidden');
    } else if (type === 'Both') {
        btnBoth.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-purple-500 bg-purple-600 text-white shadow-lg shadow-purple-900/50 transform scale-[1.02] transition uppercase text-xs";
        dispSection.classList.remove('hidden');
    }
}

window.toggleEditMutualAid = function() {
    const chk = document.getElementById('edit_mutualAid');
    const fields = document.getElementById('edit_mutualAidFields');
    if (chk.checked) {
        fields.classList.remove('hidden');
        handleEditMutualAidTypeChange(); 
    } else {
        fields.classList.add('hidden');
    }
}

window.handleEditMutualAidTypeChange = function() {
    const type = document.getElementById('edit_mutualAidType').value;
    const chips = document.getElementById('edit_deptChips');
    const input = document.getElementById('edit_mutualAidDept');

    if (type === 'Received') {
        chips.classList.remove('hidden');
        input.placeholder = "SELECT/TYPE MULTIPLE";
    } else {
        chips.classList.add('hidden');
        input.placeholder = "DEPARTMENT NAME";
    }
}

window.addUnitToEditInput = function(unitName) {
    const input = document.getElementById('edit_units');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = unitName;
    else if (!currentVal.includes(unitName)) input.value = currentVal + ", " + unitName;
}

window.addDeptToEditInput = function(deptName) {
    const input = document.getElementById('edit_mutualAidDept');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = deptName;
    else if (!currentVal.includes(deptName)) input.value = currentVal + ", " + deptName;
}

// --- LOAD DYNAMIC OPTIONS ---
async function loadConfiguration() {
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'callTrackerConfig', 'options');
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            const data = snap.data();
            
            const natureList = document.getElementById('natures');
            natureList.innerHTML = '';
            if (data.natures && Array.isArray(data.natures)) {
                data.natures.forEach(n => {
                    const opt = document.createElement('option');
                    opt.value = n.toUpperCase();
                    natureList.appendChild(opt);
                });
            }

            const maList = document.getElementById('maDepts');
            maList.innerHTML = '';
            if (data.depts && Array.isArray(data.depts)) {
                data.depts.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.toUpperCase();
                    maList.appendChild(opt);
                });
            }

            const populateChips = (containerId, items, clickHandler) => {
                const container = document.getElementById(containerId);
                if(!container) return;
                container.innerHTML = '';
                items.forEach(u => {
                    const chip = document.createElement('span');
                    chip.className = "unit-chip bg-gray-800 border border-gray-600 px-3 py-1 rounded-full text-xs font-medium text-gray-300 hover:bg-gray-700 hover:border-blue-500 hover:text-white uppercase";
                    chip.textContent = u.toUpperCase();
                    chip.onclick = () => clickHandler(u.toUpperCase());
                    container.appendChild(chip);
                });
            };

            if (data.units && Array.isArray(data.units)) {
                populateChips('unitChips', data.units, addUnitToInput);
                populateChips('edit_unitChips', data.units, addUnitToEditInput);
            }

            if (data.depts && Array.isArray(data.depts)) {
                populateChips('deptChips', data.depts, addDeptToInput);
                populateChips('edit_deptChips', data.depts, addDeptToEditInput);
            }

            if (data.schedules) {
                currentConfig.schedules = { ...currentConfig.schedules, ...data.schedules };
            } 
            else if (data.schedule) {
                currentConfig.schedules["2025"] = data.schedule;
            }

            // Load No Day Crew Dates
            if (data.noDayCrewDates && Array.isArray(data.noDayCrewDates)) {
                currentConfig.noDayCrewDates = data.noDayCrewDates;
            }

            if (data.stats) {
                currentConfig.statsConfig = { ...currentConfig.statsConfig, ...data.stats };
            }
            
            updateStats();
        }
    } catch (e) {
        console.error("Failed to load config options", e);
    }
}

window.addUnitToInput = function(unitName) {
    const input = document.getElementById('units');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = unitName;
    else if (!currentVal.includes(unitName)) input.value = currentVal + ", " + unitName;
}

window.addDeptToInput = function(deptName) {
    const input = document.getElementById('mutualAidDept');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = deptName;
    else if (!currentVal.includes(deptName)) input.value = currentVal + ", " + deptName;
}

window.handleMutualAidTypeChange = function() {
    const type = document.getElementById('mutualAidType').value;
    const chips = document.getElementById('deptChips');
    const input = document.getElementById('mutualAidDept');

    if (type === 'Received') {
        chips.classList.remove('hidden');
        input.placeholder = "SELECT/TYPE MULTIPLE (E.G. NORTH FD, SOUTH FD)";
    } else {
        chips.classList.add('hidden');
        input.placeholder = "DEPARTMENT NAME";
    }
}

window.selectType = function(type) {
    document.getElementById('responseType').value = type;
    const btnEms = document.getElementById('btn-ems');
    const btnFire = document.getElementById('btn-fire');
    const btnBoth = document.getElementById('btn-both');
    const dispSection = document.getElementById('emsDispositionSection');
    const baseClass = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700 transition uppercase";
    btnEms.className = baseClass;
    btnFire.className = baseClass;
    btnBoth.className = baseClass;
    
    if(type === 'EMS') {
        btnEms.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-900/50 transform scale-[1.02] transition uppercase";
        dispSection.classList.remove('hidden');
    } else if (type === 'Fire') {
        btnFire.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-red-500 bg-red-600 text-white shadow-lg shadow-red-900/50 transform scale-[1.02] transition uppercase";
        dispSection.classList.add('hidden');
    } else if (type === 'Both') {
        btnBoth.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-purple-500 bg-purple-600 text-white shadow-lg shadow-purple-900/50 transform scale-[1.02] transition uppercase";
        dispSection.classList.remove('hidden');
    }
}

window.autoFormatTime = function(el) {
    let v = el.value.replace(/\D/g, ''); 
    if (v.length >= 3) {
        v = v.slice(0, 2) + ':' + v.slice(2);
    }
    if (v.length > 5) v = v.slice(0, 5);
    el.value = v;
}

window.validateTime = function(el) {
    const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (el.value && !regex.test(el.value)) {
        showToast("INVALID TIME FORMAT. USE 24H HH:MM", true);
        el.classList.add('border-red-500', 'ring-2', 'ring-red-500');
        el.classList.remove('border-gray-600');
    } else {
        el.classList.remove('border-red-500', 'ring-2', 'ring-red-500');
        el.classList.add('border-gray-600');
        if(el.value.length === 4 && el.value.indexOf(':') === 1) {
                el.value = '0' + el.value;
        }
    }
}

// --- EXPORT CSV LOGIC ---
window.exportToCSV = function() {
    if (!allCalls || allCalls.length === 0) {
        showToast("NO DATA TO EXPORT", true);
        return;
    }
    const headers = ['Incident #', 'Date/Time', 'Nature', 'Address', 'Type', 'Units', 'Mutual Aid', 'Disposition', 'Notes'];
    const rows = allCalls.map(c => {
        let reported = '';
        if (c.dispatchDate && c.dispatchTime) {
            try {
                const [y, m, d] = c.dispatchDate.split('-');
                reported = `${m}/${d}/${y} ${c.dispatchTime}`;
            } catch(e) {}
        }
        let mutualAidStr = '';
        if (c.mutualAid) {
            const type = c.mutualAidType ? c.mutualAidType.toUpperCase() : 'UNKNOWN';
            const dept = c.mutualAidDept ? c.mutualAidDept : '';
            mutualAidStr = `${type} - ${dept}`;
        }
        const escapeCsv = (txt) => {
            if (!txt) return '';
            const str = String(txt);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };
        return [
            c.incidentNumber,
            reported,
            escapeCsv(c.callNature),
            escapeCsv(c.address),
            c.responseType === 'Fire' ? 'FIRE' : (c.responseType === 'EMS' ? 'EMS' : 'BOTH'),
            escapeCsv(c.units),
            escapeCsv(mutualAidStr),
            escapeCsv(c.emsDisposition),
            escapeCsv(c.notes)
        ].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `RMS_Export_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- CSV IMPORT LOGIC ---
window.handleFileUpload = function(input) {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById('importStatus');
    statusEl.textContent = "READING FILE...";
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        try {
            statusEl.textContent = "PARSING CSV...";
            
            // Simple CSV Parse Logic
            const parseCSV = (str) => {
                const arr = [];
                let quote = false;
                let row = [];
                let col = '';
                for (let c of str) {
                    if (c === '"') { quote = !quote; continue; }
                    if (c === ',' && !quote) { row.push(col); col = ''; continue; }
                    if (c === '\n' && !quote) { row.push(col); col = ''; arr.push(row); row = []; continue; }
                    col += c;
                }
                if (row.length > 0) arr.push(row);
                return arr;
            }
            const rows = parseCSV(text);
            
            if (rows.length < 2) {
                alert("CSV SEEMS EMPTY OR INVALID FORMAT.");
                statusEl.textContent = "";
                return;
            }

            const existingIncidents = new Map();
            allCalls.forEach(call => {
                if (call.incidentNumber) existingIncidents.set(call.incidentNumber, call.id);
            });

            const ops = []; 
            let parseErrors = 0;

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < 2) continue; 

                try {
                    const incNum = row[0]?.trim().toUpperCase();
                    if (!incNum) continue;

                    const reported = row[1]?.trim(); 
                    const nature = row[2]?.trim().toUpperCase();
                    const address = row[3]?.trim().toUpperCase();
                    const typeRaw = row[4]?.trim().toUpperCase(); 
                    const units = row[5]?.trim().toUpperCase();
                    const mutualAidCombined = row[6]?.trim(); 
                    const disposition = row[7]?.trim().toUpperCase();
                    const notes = row[8]?.trim().toUpperCase();

                    let formattedDate = '';
                    let formattedTime = '';
                    if (reported && reported.includes(' ')) {
                        const [datePart, timePart] = reported.split(' ');
                        const [m, d, y] = datePart.split('/');
                        formattedDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
                        formattedTime = timePart;
                        if (timePart.length === 4 && timePart.indexOf(':') === 1) {
                            formattedTime = '0' + timePart;
                        }
                    }

                    const yearShort = incNum.substring(0, 2); 
                    const yearFull = 2000 + parseInt(yearShort);
                    const seqStr = incNum.replace(yearShort + 'HT', '').replace(yearShort + 'PL', '');
                    const seqNum = parseInt(seqStr);

                    let finalType = 'Both';
                    if (typeRaw === 'FIRE') finalType = 'Fire';
                    if (typeRaw === 'EMS') finalType = 'EMS';

                    let isMa = false;
                    let maType = null;
                    let maDept = null;

                    if (mutualAidCombined && mutualAidCombined.length > 2) {
                        isMa = true;
                        if (mutualAidCombined.toUpperCase().includes('GIVEN')) {
                            maType = 'Given';
                        } else if (mutualAidCombined.toUpperCase().includes('RECEIVED')) {
                            maType = 'Received';
                        } else {
                            maType = 'Given'; 
                        }
                        if (mutualAidCombined.includes(' - ')) {
                            maDept = mutualAidCombined.split(' - ')[1]?.trim().toUpperCase() || '';
                        } else {
                            maDept = '';
                        }
                    }

                    const recordData = {
                        incidentNumber: incNum,
                        sequence: seqNum,
                        year: yearFull,
                        dispatchDate: formattedDate,
                        dispatchTime: formattedTime,
                        callNature: nature,
                        responseType: finalType,
                        address: address,
                        units: units || '',
                        mutualAid: isMa,
                        mutualAidType: maType,
                        mutualAidDept: maDept,
                        emsDisposition: disposition || '',
                        notes: notes || '',
                        imported: true
                    };

                    if (existingIncidents.has(incNum)) {
                        ops.push({
                            type: 'update',
                            id: existingIncidents.get(incNum),
                            data: {
                                ...recordData,
                                lastModified: new Date().toISOString(),
                                lastModifiedBy: currentUser.uid
                            }
                        });
                    } else {
                        ops.push({
                            type: 'create',
                            data: {
                                ...recordData,
                                createdAt: new Date().toISOString(),
                                createdBy: currentUser.uid
                            }
                        });
                    }

                } catch (err) {
                    parseErrors++;
                }
            }

            if (ops.length === 0) {
                alert("NO VALID ROWS FOUND TO IMPORT.");
                statusEl.textContent = "";
                return;
            }

            const updates = ops.filter(o => o.type === 'update').length;
            const creates = ops.filter(o => o.type === 'create').length;

            // Batch helper
            const batchUpload = async (operations) => {
                const batchSize = 500;
                for (let i = 0; i < operations.length; i += batchSize) {
                    const chunk = operations.slice(i, i + batchSize);
                    const batch = writeBatch(db);
                    chunk.forEach(op => {
                        if (op.type === 'create') {
                            const ref = doc(collection(db, 'artifacts', appId, 'public', 'data', 'calls'));
                            batch.set(ref, op.data);
                        } else {
                            const ref = doc(db, 'artifacts', appId, 'public', 'data', 'calls', op.id);
                            batch.update(ref, op.data);
                        }
                    });
                    await batch.commit();
                }
            }

            if (confirm(`IMPORT SUMMARY:\n- NEW RECORDS: ${creates}\n- UPDATING RECORDS: ${updates}\n\nPROCEED?`)) {
                statusEl.textContent = `PROCESSING...`;
                await batchUpload(ops);
                statusEl.textContent = "DONE!";
                showToast(`SUCCESS: ${creates} CREATED, ${updates} UPDATED!`);
                input.value = ''; 
            } else {
                statusEl.textContent = "CANCELLED.";
                input.value = '';
            }

        } catch (e) {
            console.error("Import error:", e);
            statusEl.textContent = "ERROR PARSING FILE.";
            alert("ERROR PARSING CSV. CHECK CONSOLE.");
        }
    };
    reader.readAsText(file);
};

// --- Firestore Listener ---
function setupRealtimeListener() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'calls');

    onSnapshot(q, (snapshot) => {
        const calls = [];
        snapshot.forEach((doc) => {
            calls.push({ id: doc.id, ...doc.data() });
        });
        
        // Initial sort by ID to establish a baseline before UI sorting
        calls.sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return b.sequence - a.sequence;
        });

        allCalls = calls;
        calculateNextIncidentId();
        populateYearSelect(); 
        updateStats();
        updateAddressHistory();
        renderTable(); // This handles sorting and filtering
    }, (error) => {
        console.error("Firestore Error:", error);
        showToast("ERROR LOADING DATA", true);
    });
}

let sortedAddressList = []; 

function updateAddressHistory() {
    const addressCounts = {};
    allCalls.forEach(call => {
        if (call.address) {
            const addr = call.address.trim().toUpperCase();
            if (addr && addr !== 'UNKNOWN') {
                addressCounts[addr] = (addressCounts[addr] || 0) + 1;
            }
        }
    });
    sortedAddressList = Object.entries(addressCounts)
        .sort((a, b) => b[1] - a[1]) 
        .map(entry => entry[0]);
}

const addrInput = document.getElementById('address');
const suggestionBox = document.getElementById('addressSuggestions');

if(addrInput && suggestionBox) {
    addrInput.addEventListener('input', function() {
        const val = this.value.toUpperCase();
        if (val.length < 2) {
            suggestionBox.classList.add('hidden');
            return;
        }
        const matches = sortedAddressList.filter(a => a.includes(val)).slice(0, 5);
        
        if (matches.length === 0) {
            suggestionBox.classList.add('hidden');
            return;
        }
        suggestionBox.innerHTML = '';
        matches.forEach(addr => {
            const div = document.createElement('div');
            div.className = "px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-300 border-b border-gray-700 last:border-0 uppercase font-medium";
            const regex = new RegExp(`(${val})`, 'gi');
            const highlighted = addr.replace(regex, '<span class="text-blue-400 font-bold">$1</span>');
            div.innerHTML = highlighted;
            div.onclick = () => {
                addrInput.value = addr;
                suggestionBox.classList.add('hidden');
            };
            suggestionBox.appendChild(div);
        });
        suggestionBox.classList.remove('hidden');
    });
    document.addEventListener('click', function(e) {
        if (e.target !== addrInput && !suggestionBox.contains(e.target)) {
            suggestionBox.classList.add('hidden');
        }
    });
}

window.populateYearSelect = function() {
    const select = document.getElementById('statsYearSelect');
    const years = new Set(allCalls.map(c => c.year));
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    const existingSelection = select.value ? parseInt(select.value) : currentStatsYear;
    
    select.innerHTML = '';
    sortedYears.forEach(year => {
        const opt = document.createElement('option');
        opt.value = year;
        opt.textContent = year;
        if (year === existingSelection) opt.selected = true;
        select.appendChild(opt);
    });
    
    if (!years.has(existingSelection)) {
        select.value = sortedYears[0];
        currentStatsYear = sortedYears[0];
    } else {
        currentStatsYear = existingSelection;
    }
    document.getElementById('statsTitle').textContent = `${currentStatsYear} Statistics`;
}

window.handleStatsYearChange = function(el) {
    currentStatsYear = parseInt(el.value);
    document.getElementById('statsTitle').textContent = `${currentStatsYear} Statistics`;
    updateStats();
}

function calculateNextIncidentId() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const yearShort = currentYear.toString().slice(-2);
    const thisYearCalls = allCalls.filter(c => c.year === currentYear);
    
    let maxSeq = 0;
    if (thisYearCalls.length > 0) {
        maxSeq = Math.max(...thisYearCalls.map(c => c.sequence || 0));
    }
    const nextSeq = maxSeq + 1;
    const seqPadded = String(nextSeq).padStart(5, '0');
    const nextId = `${yearShort}PL${seqPadded}`;

    nextIncidentData = {
        id: nextId,
        seq: nextSeq,
        year: currentYear
    };
    document.getElementById('previewIncidentId').textContent = nextId;
}

// --- Form Handling (NEW CALL) ---
const form = document.getElementById('callForm');

function setNowDefaults() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${h}:${m}`;
    document.getElementById('dispatchDate').value = dateStr;
    document.getElementById('dispatchTime').value = timeStr;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    const originalBtnText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> SAVING...';

    try {
        const timeInput = document.getElementById('dispatchTime');
        validateTime(timeInput);
        if (timeInput.classList.contains('border-red-500')) {
            throw new Error("Invalid Time");
        }
        calculateNextIncidentId();

        const isMutualAid = document.getElementById('mutualAid').checked;
        const responseType = document.getElementById('responseType').value;
        const emsDisp = (responseType === 'EMS' || responseType === 'Both') 
            ? document.getElementById('emsDisposition').value 
            : null;
        
        const newCall = {
            incidentNumber: nextIncidentData.id,
            sequence: nextIncidentData.seq,
            year: nextIncidentData.year,
            dispatchDate: document.getElementById('dispatchDate').value,
            dispatchTime: document.getElementById('dispatchTime').value,
            callNature: document.getElementById('callNature').value.toUpperCase(),
            responseType: responseType,
            emsDisposition: emsDisp,
            address: document.getElementById('address').value.toUpperCase(),
            units: document.getElementById('units').value.toUpperCase(),
            mutualAid: isMutualAid,
            mutualAidType: isMutualAid ? document.getElementById('mutualAidType').value : null,
            mutualAidDept: isMutualAid ? document.getElementById('mutualAidDept').value.toUpperCase() : null,
            notes: document.getElementById('notes').value.toUpperCase(),
            createdAt: new Date().toISOString(),
            createdBy: currentUser.uid
        };

        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'calls'), newCall);
        showToast(`CALL ${newCall.incidentNumber} SAVED!`);
        form.reset();
        setNowDefaults();
        document.getElementById('mutualAid').checked = false; 
        toggleMutualAid(); // Reset mutual aid fields visibility
        switchTab('history'); 

    } catch (error) {
        console.error("Save Error:", error);
        if (error.message !== "Invalid Time") {
            showToast("FAILED TO SAVE CALL", true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalBtnText;
    }
});

// --- Render Functions (UPDATED FOR SORTING & FILTERING) ---
window.renderTable = function() {
    // Update UI for Sort
    updateSortIcons();

    const tbody = document.getElementById('historyTableBody');
    
    // 1. Get Filters
    const search = document.getElementById('searchInput').value.toLowerCase();
    const filterStart = document.getElementById('filterDateStart').value;
    const filterEnd = document.getElementById('filterDateEnd').value;
    const filterType = document.getElementById('filterType').value;
    const filterNature = document.getElementById('filterNature').value.toUpperCase();
    const filterDisp = document.getElementById('filterDisposition').value;
    const filterMutual = document.getElementById('filterMutual').value;
    const filterUnits = document.getElementById('filterUnits').value.toUpperCase();

    // 2. Filter Data
    let filtered = allCalls.filter(call => {
        // Text Search (Notes, Address, ID)
        const text = `${call.incidentNumber} ${call.address} ${call.notes || ''}`.toLowerCase();
        if (search && !text.includes(search)) return false;

        // Date Range
        if (filterStart && call.dispatchDate < filterStart) return false;
        if (filterEnd && call.dispatchDate > filterEnd) return false;

        // Type
        if (filterType && filterType !== 'BOTH' && call.responseType !== filterType && call.responseType !== 'Both') return false;
        if (filterType === 'BOTH' && call.responseType !== 'Both') return false; // Strict check for BOTH if selected

        // Nature
        if (filterNature && (!call.callNature || !call.callNature.includes(filterNature))) return false;

        // Disposition
        if (filterDisp && call.emsDisposition !== filterDisp) return false;

        // Units
        if (filterUnits && (!call.units || !call.units.includes(filterUnits))) return false;

        // Mutual Aid
        if (filterMutual) {
            if (filterMutual === 'NO' && call.mutualAid) return false;
            if (filterMutual === 'YES' && !call.mutualAid) return false;
            if (filterMutual === 'GIVEN' && (!call.mutualAid || call.mutualAidType !== 'Given')) return false;
            if (filterMutual === 'RECEIVED' && (!call.mutualAid || call.mutualAidType !== 'Received')) return false;
        }

        return true;
    });

    // 3. Update Count
    document.getElementById('recordCount').textContent = `${filtered.length} Records`;

    // 4. Sort Data
    filtered.sort((a, b) => {
        let valA = a[sortState.col];
        let valB = b[sortState.col];
        
        // Special handlers
        if (sortState.col === 'incident') {
                // Sort by year then sequence
                if (a.year !== b.year) return a.year - b.year;
                return (a.sequence || 0) - (b.sequence || 0);
        }
        if (sortState.col === 'datetime') {
            const timeA = `${a.dispatchDate} ${a.dispatchTime}`;
            const timeB = `${b.dispatchDate} ${b.dispatchTime}`;
            return timeA.localeCompare(timeB);
        }
        if (sortState.col === 'mutual') {
            // Sort by type then dept
            const strA = a.mutualAid ? `${a.mutualAidType} ${a.mutualAidDept}` : '';
            const strB = b.mutualAid ? `${b.mutualAidType} ${b.mutualAidDept}` : '';
            return strA.localeCompare(strB);
        }

        // Default String Compare
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';
        
        if (typeof valA === 'string') return valA.localeCompare(valB);
        return valA - valB;
    });

    // Reverse if Descending
    if (!sortState.asc) {
        filtered.reverse();
    }

    // 5. Render
    tbody.innerHTML = '';
    if (filtered.length === 0) {
        document.getElementById('emptyState').classList.remove('hidden');
        return;
    } else {
        document.getElementById('emptyState').classList.add('hidden');
    }

    filtered.forEach(call => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-750 transition uppercase cursor-pointer";
        tr.onclick = () => openEditModal(call.id); 
        
        let typeBadge = '';
        if(call.responseType === 'Fire') typeBadge = '<span class="bg-red-900 text-red-200 text-xs px-2 py-1 rounded">FIRE</span>';
        else if(call.responseType === 'EMS') typeBadge = '<span class="bg-blue-900 text-blue-200 text-xs px-2 py-1 rounded">EMS</span>';
        else typeBadge = '<span class="bg-purple-900 text-purple-200 text-xs px-2 py-1 rounded">BOTH</span>';

        let dateDisplay = call.dispatchDate;
        try {
            const [y, m, d] = call.dispatchDate.split('-');
            dateDisplay = `${m}/${d}/${y}`;
        } catch(e) {}

        let maDisplay = '<span class="text-gray-600">-</span>';
        if (call.mutualAid) {
            const maColor = call.mutualAidType === 'Given' ? 'text-yellow-400' : 'text-green-400';
            const icon = call.mutualAidType === 'Given' ? 'fa-arrow-right' : 'fa-arrow-left';
            maDisplay = `<div class="text-xs">
                <span class="${maColor} font-bold"><i class="fa-solid ${icon}"></i> ${call.mutualAidType.toUpperCase()}</span>
                <div class="text-gray-400 truncate w-24" title="${call.mutualAidDept}">${call.mutualAidDept}</div>
            </div>`;
        }
        
        let notesDisplay = call.notes || '';
        if(notesDisplay.length > 50) notesDisplay = notesDisplay.substring(0,50) + '...';

        let dispDisplay = call.emsDisposition || '<span class="text-gray-600">-</span>';

        tr.innerHTML = `
            <td class="p-4 font-mono font-bold text-white">${call.incidentNumber}</td>
            <td class="p-4 text-gray-300">
                <div>${dateDisplay}</div>
                <div class="text-xs text-gray-500 font-mono tracking-wide">${call.dispatchTime}</div>
            </td>
            <td class="p-4 font-medium">${call.callNature}</td>
            <td class="p-4 text-gray-400 truncate max-w-[150px]" title="${call.address}">${call.address}</td>
            <td class="p-4">${typeBadge}</td>
            <td class="p-4 text-gray-400 text-xs truncate max-w-[100px]" title="${call.units}">${call.units}</td>
            <td class="p-4">${maDisplay}</td>
            <td class="p-4 text-gray-400 text-xs truncate max-w-[100px]" title="${call.emsDisposition || ''}">${dispDisplay}</td>
            <td class="p-4 text-gray-400 text-xs max-w-[200px]" title="${call.notes}">${notesDisplay}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updateStats() {
    const thisYearCalls = allCalls.filter(c => c.year === currentStatsYear);
    document.getElementById('stat-total').textContent = thisYearCalls.length;
    
    const fireCount = thisYearCalls.filter(c => c.responseType === 'Fire' || c.responseType === 'Both').length;
    const emsCount = thisYearCalls.filter(c => c.responseType === 'EMS' || c.responseType === 'Both').length;
    
    document.getElementById('stat-fire').textContent = fireCount;
    document.getElementById('stat-ems').textContent = emsCount;

    const config = currentConfig.statsConfig || { showNatures: true, showAddresses: true, showMutual: true, showCrew: true, showVolDispo: true, limit: 5 };
    const limit = config.limit || 5;

    let sched = { wdStart: 6, wdEnd: 18, weStart: 8, weEnd: 18 };
    if (currentConfig.schedules && currentConfig.schedules[String(currentStatsYear)]) {
        sched = currentConfig.schedules[String(currentStatsYear)];
    }
    const { wdStart, wdEnd, weStart, weEnd } = sched;

    // CHECK DAY CREW HELPER - UPDATED FOR NO-CREW DATES
    const checkDayCrew = (c) => {
        if (!c.dispatchDate || !c.dispatchTime) return false;

        // 1. CHECK EXCEPTION DATES FIRST
        // If the date is in the "No Day Crew" list, force it to return false (Volunteer)
        if (currentConfig.noDayCrewDates && currentConfig.noDayCrewDates.includes(c.dispatchDate)) {
            return false;
        }

        // 2. Standard Time Logic
        try {
            const [y, m, d] = c.dispatchDate.split('-').map(Number);
            const [h, min] = c.dispatchTime.split(':').map(Number);
            const dateObj = new Date(y, m - 1, d, h, min);
            const day = dateObj.getDay(); 
            const hour = h;

            if (day >= 1 && day <= 5) {
                return (hour >= wdStart && hour < wdEnd);
            } else {
                return (hour >= weStart && hour < weEnd);
            }
        } catch(e) { return false; }
    };

    const wNatures = document.getElementById('widget-natures');
    if (!config.showNatures) {
        wNatures.classList.add('hidden');
    } else {
        wNatures.classList.remove('hidden');
        const natureCounts = {};
        thisYearCalls.forEach(c => {
            const n = c.callNature || 'UNKNOWN';
            natureCounts[n] = (natureCounts[n] || 0) + 1;
        });
        const sortedNatures = Object.entries(natureCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit); 
        const natureListEl = document.getElementById('stats-natures');
        natureListEl.innerHTML = '';
        if (sortedNatures.length === 0) {
            natureListEl.innerHTML = '<div class="text-gray-500 text-sm italic">No data available</div>';
        } else {
            const maxCount = sortedNatures[0][1];
            sortedNatures.forEach(([name, count]) => {
                const barWidth = (count / maxCount) * 100; 
                const row = document.createElement('div');
                row.innerHTML = `
                    <div class="flex justify-between text-xs mb-1 uppercase font-semibold">
                        <span>${name}</span>
                        <span>${count}</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2">
                        <div class="bg-blue-500 h-2 rounded-full transition-all duration-500" style="width: ${barWidth}%"></div>
                    </div>
                `;
                natureListEl.appendChild(row);
            });
        }
    }

    const wAddresses = document.getElementById('widget-addresses');
    if (!config.showAddresses) {
        wAddresses.classList.add('hidden');
    } else {
        wAddresses.classList.remove('hidden');
        const addressCounts = {};
        thisYearCalls.forEach(c => {
            let addr = c.address ? c.address.trim().toUpperCase() : 'UNKNOWN';
            if (addr.includes('I 70')) addr = 'I 70'; 
            if (addr !== 'UNKNOWN' && addr !== '') addressCounts[addr] = (addressCounts[addr] || 0) + 1;
        });
        const sortedAddresses = Object.entries(addressCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit); 
        const addrListEl = document.getElementById('stats-addresses');
        addrListEl.innerHTML = '';
        if (sortedAddresses.length === 0) {
            addrListEl.innerHTML = '<div class="text-gray-500 text-sm italic">No data available</div>';
        } else {
            const maxAddrCount = sortedAddresses[0][1];
            sortedAddresses.forEach(([addr, count]) => {
                const barWidth = (count / maxAddrCount) * 100;
                const row = document.createElement('div');
                row.innerHTML = `
                    <div class="flex justify-between text-xs mb-1 uppercase font-semibold">
                        <span class="truncate pr-2" title="${addr}">${addr}</span>
                        <span>${count}</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2">
                        <div class="bg-purple-500 h-2 rounded-full transition-all duration-500" style="width: ${barWidth}%"></div>
                    </div>
                `;
                addrListEl.appendChild(row);
            });
        }
    }

    const wMutual = document.getElementById('widget-mutual');
    if (!config.showMutual) {
        wMutual.classList.add('hidden');
    } else {
        wMutual.classList.remove('hidden');
        let givenCount = 0;
        let receivedCount = 0;
        let givenDay = 0, givenVol = 0;
        let receivedDay = 0, receivedVol = 0;
        const maDepts = {};

        thisYearCalls.forEach(c => {
            if (c.responseType === 'Fire') return;
            if (c.mutualAid) {
                const isDay = checkDayCrew(c);
                if (c.mutualAidType === 'Given') {
                    givenCount++;
                    if (isDay) givenDay++; else givenVol++;
                }
                if (c.mutualAidType === 'Received') {
                    receivedCount++;
                    if (isDay) receivedDay++; else receivedVol++;
                }
                if (c.mutualAidDept) {
                    const depts = c.mutualAidDept.split(',').map(s => s.trim());
                    depts.forEach(d => {
                        if(d) maDepts[d] = (maDepts[d] || 0) + 1;
                    });
                }
            }
        });

        document.getElementById('stat-ma-given').textContent = givenCount;
        document.getElementById('stat-ma-received').textContent = receivedCount;
        document.getElementById('stat-ma-given-day').textContent = givenDay;
        document.getElementById('stat-ma-given-vol').textContent = givenVol;
        document.getElementById('stat-ma-received-day').textContent = receivedDay;
        document.getElementById('stat-ma-received-vol').textContent = receivedVol;

        const sortedDepts = Object.entries(maDepts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit); 

        const deptListEl = document.getElementById('stats-ma-depts');
        deptListEl.innerHTML = '';
        sortedDepts.forEach(([name, count]) => {
            const li = document.createElement('li');
            li.className = "flex justify-between border-b border-gray-700 py-1 last:border-0";
            li.innerHTML = `<span>${name}</span> <span class="font-bold text-white">${count}</span>`;
            deptListEl.appendChild(li);
        });
    }

    const wCrew = document.getElementById('widget-crew');
    const wVolDispo = document.getElementById('widget-voldispo');

    let dayCrewCount = 0;
    let volunteerCount = 0;
    let volNoCrewCount = 0; // NEW: Track missed calls
    const volDispCounts = {};

    document.getElementById('stats-sched-text-wd').textContent = `M-F: ${String(wdStart).padStart(2,'0')}:00 - ${String(wdEnd).padStart(2,'0')}:00 (Day Crew)`;
    document.getElementById('stats-sched-text-we').textContent = `S-S: ${String(weStart).padStart(2,'0')}:00 - ${String(weEnd).padStart(2,'0')}:00 (Day Crew)`;

    thisYearCalls.forEach(c => {
        if (c.responseType === 'Fire') return;
        const isDayCrew = checkDayCrew(c);
        if (isDayCrew) {
            dayCrewCount++;
        } else {
            volunteerCount++;
            const disp = c.emsDisposition || 'NOT RECORDED';
            if (disp === 'NO CREW/MA') volNoCrewCount++; // NEW: Increment missed count
            volDispCounts[disp] = (volDispCounts[disp] || 0) + 1;
        }
    });

    if (!config.showCrew) {
        wCrew.classList.add('hidden');
    } else {
        wCrew.classList.remove('hidden');
        document.getElementById('stat-crew-day').textContent = dayCrewCount;
        document.getElementById('stat-crew-vol').textContent = volunteerCount;

        // NEW: Calculate Percentage
        const volPct = volunteerCount > 0 
            ? (((volunteerCount - volNoCrewCount) / volunteerCount) * 100).toFixed(0) 
            : 0;
        const pctEl = document.getElementById('stat-crew-vol-pct');
        if(pctEl) pctEl.textContent = `${volPct}% RESP`;

    }

    if (!config.showVolDispo) {
        wVolDispo.classList.add('hidden');
    } else {
        wVolDispo.classList.remove('hidden');
        const volDispListEl = document.getElementById('stats-vol-dispo');
        volDispListEl.innerHTML = '';
        const sortedVolDisps = Object.entries(volDispCounts)
            .sort((a, b) => b[1] - a[1]); 

        if (sortedVolDisps.length === 0) {
            volDispListEl.innerHTML = '<div class="text-gray-500 text-sm italic">No data available</div>';
        } else {
            const maxCount = sortedVolDisps[0][1];
            sortedVolDisps.forEach(([name, count]) => {
                const barWidth = (count / maxCount) * 100;
                const row = document.createElement('div');
                row.innerHTML = `
                    <div class="flex justify-between text-xs mb-1 uppercase font-semibold">
                        <span>${name}</span>
                        <span>${count}</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2">
                        <div class="bg-orange-500 h-2 rounded-full transition-all duration-500" style="width: ${barWidth}%"></div>
                    </div>
                `;
                volDispListEl.appendChild(row);
            });
        }
    }

    // --- MONTHLY BREAKDOWN ---
    const wMonthly = document.getElementById('widget-monthly');
    const monthlyContainer = document.getElementById('stats-monthly');
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const monthlyData = months.map(m => ({ name: m, total: 0, fire: 0, ems: 0, both: 0 }));

    thisYearCalls.forEach(c => {
        if(!c.dispatchDate) return;
        try {
            const [y, m, d] = c.dispatchDate.split('-'); // Format YYYY-MM-DD
            const monthIndex = parseInt(m) - 1; // 0-11
            if(monthIndex >= 0 && monthIndex < 12) {
                monthlyData[monthIndex].total++;
                if(c.responseType === 'Fire') monthlyData[monthIndex].fire++;
                else if(c.responseType === 'EMS') monthlyData[monthIndex].ems++;
                else if(c.responseType === 'Both') monthlyData[monthIndex].both++;
            }
        } catch(e) {}
    });

    monthlyContainer.innerHTML = '';
    monthlyData.forEach(d => {
        const card = document.createElement('div');
        card.className = "bg-gray-900/50 p-3 rounded border border-gray-700 flex flex-col gap-2 hover:bg-gray-800 transition";
        card.innerHTML = `
            <div class="flex justify-between items-center border-b border-gray-700 pb-2 mb-1">
                <span class="font-bold text-gray-300 text-sm">${d.name}</span>
                <span class="font-bold text-white text-lg">${d.total}</span>
            </div>
            <div class="grid grid-cols-3 gap-2">
                <div class="flex flex-col items-center bg-red-900/20 p-2 rounded border border-red-900/50">
                    <span class="text-[10px] text-red-400 font-bold uppercase mb-1">FIRE</span>
                    <span class="text-white font-bold text-sm">${d.fire}</span>
                </div>
                <div class="flex flex-col items-center bg-blue-900/20 p-2 rounded border border-blue-900/50">
                    <span class="text-[10px] text-blue-400 font-bold uppercase mb-1">EMS</span>
                    <span class="text-white font-bold text-sm">${d.ems}</span>
                </div>
                <div class="flex flex-col items-center bg-purple-900/20 p-2 rounded border border-purple-900/50">
                    <span class="text-[10px] text-purple-400 font-bold uppercase mb-1">BOTH</span>
                    <span class="text-white font-bold text-sm">${d.both}</span>
                </div>
            </div>
        `;
        monthlyContainer.appendChild(card);
    });
}

window.showToast = function(msg, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toastMessage');
    
    toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-xl transform transition-all duration-300 z-50 flex items-center gap-3 ${isError ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`;
    msgEl.textContent = msg;
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
}

window.toggleMutualAid = function() {
    const chk = document.getElementById('mutualAid');
    const fields = document.getElementById('mutualAidFields');
    const inputs = fields.querySelectorAll('input, select');
    
    if (chk.checked) {
        fields.classList.remove('hidden');
        inputs.forEach(i => i.required = true);
        handleMutualAidTypeChange(); 
    } else {
        fields.classList.add('hidden');
        inputs.forEach(i => i.required = false);
    }
}

window.switchTab = function(tabName) {
    const entryTab = document.getElementById('tab-entry');
    const historyTab = document.getElementById('tab-history');
    const statsTab = document.getElementById('tab-stats');
    
    const btnEntry = document.getElementById('btn-entry');
    const btnHistory = document.getElementById('btn-history');
    const btnStats = document.getElementById('btn-stats');

    const inactiveClass = "px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-medium hover:bg-gray-600 transition border border-gray-600 uppercase text-sm tracking-wider";
    const activeClass = "px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition shadow-md border border-red-500 uppercase text-sm tracking-wider";
    
    btnEntry.className = inactiveClass;
    btnHistory.className = inactiveClass;
    btnStats.className = inactiveClass;

    entryTab.classList.add('hidden');
    historyTab.classList.add('hidden');
    statsTab.classList.add('hidden');

    if (tabName === 'entry') {
        entryTab.classList.remove('hidden');
        btnEntry.className = activeClass;
    } else if (tabName === 'history') {
        historyTab.classList.remove('hidden');
        btnHistory.className = activeClass;
        renderTable();
    } else if (tabName === 'stats') {
        statsTab.classList.remove('hidden');
        btnStats.className = activeClass;
        updateStats(); 
    }
}

window.resetForm = function() {
    document.getElementById('callForm').reset();
    setNowDefaults();
    toggleMutualAid(); 
    selectType('EMS'); 
    calculateNextIncidentId(); 
}