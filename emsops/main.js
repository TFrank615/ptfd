import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot, addDoc, setDoc, getDoc, deleteDoc, doc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL CONFIG ---
// Prioritize environment config, fall back to new config
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyAEELEzdEeTgidrSjThsTH2-uDPnFindb0",
    authDomain: "pleasant-township-48aa9.firebaseapp.com",
    projectId: "pleasant-township-48aa9",
    storageBucket: "pleasant-township-48aa9.firebasestorage.app",
    messagingSenderId: "859989513428",
    appId: "1:859989513428:web:097a276b3ed90d80e35741",
    measurementId: "G-V3HNW1E3S4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let currentUser = null;
// Dynamic appId support for shared instances or fallback
const currentAppId = (typeof __app_id !== 'undefined') ? __app_id : 'default-app-id';

// --- HELPER FOR STRICT PATHS ---
const getCollectionPath = (name) => `artifacts/${currentAppId}/public/data/${name}`;

// --- ROUTER & UI LOGIC ---
window.Router = {
    current: 'dashboard',
    navigate: function(viewId) {
        // Hide all views
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        // Deselect nav
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

        // Show target
        document.getElementById(`view-${viewId}`).classList.add('active');
        const navLink = document.getElementById(`nav-${viewId}`);
        if(navLink) navLink.classList.add('active');

        this.current = viewId;
        
        // Close mobile menu if open
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
        // Restore desktop Sidebar visibility logic
        if(window.innerWidth >= 768) {
            sidebar.classList.remove('-translate-x-full', 'translate-x-0');
        }

        // Trigger Load Data if needed
        if(viewId === 'inventory') InventoryApp.init();
        if(viewId === 'transactions') TransactionApp.init();
        if(viewId === 'drugbag') DrugBagApp.init();
        if(viewId === 'oxygen') OxygenApp.init();
        if(viewId === 'destruction') DestructionApp.init();
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

// --- SHARED UTILS ---
window.printReportModal = function() {
    const content = document.getElementById('report_preview_body').innerHTML;
    const win = window.open('', '_blank');
    win.document.write('<html><head><title>Print Report</title></head><body>');
    win.document.write(content);
    win.document.write('<script>window.print();' + '<' + '/script></body></html>');
    win.document.close();
};

window.showNotification = function(msg, type = 'success') {
    const notif = document.getElementById('notification');
    const icon = document.getElementById('notif-icon');
    const text = document.getElementById('notif-message');
    
    notif.className = `fixed top-4 right-4 z-[60] px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 transition-all transform translate-y-0 ${type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`;
    
    icon.innerHTML = type === 'error' 
        ? '<i class="fa-solid fa-triangle-exclamation text-xl"></i>' 
        : '<i class="fa-solid fa-circle-check text-xl"></i>';
    
    text.textContent = msg;
    notif.classList.remove('hidden');
    
    setTimeout(() => {
        notif.classList.add('hidden');
    }, 3000);
};

// --- LOGIN LOGIC ---
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    loginError.classList.add('hidden');
    
    try {
        await signInWithEmailAndPassword(auth, email, password);
        // Auth listener will handle the UI switch
    } catch (error) {
        console.error("Login failed", error);
        loginError.classList.remove('hidden');
        document.getElementById('login-error-msg').textContent = "Invalid email or password.";
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
    }
});

window.handleLogout = async () => {
     try {
         await signOut(auth);
         // Auth listener handles UI
     } catch (error) {
         console.error("Logout failed", error);
     }
};

// --- APP MODULES ---


/* ================= INVENTORY MODULE ================= */
const InventoryApp = {
    listener: null,
    data: [],
    selectedItem: null,

    init: function() {
        if(this.listener) return; // Already listening
        if(!currentUser) return; 

        // UPDATED PATH
        const q = query(collection(db, getCollectionPath('supplies')));
        document.getElementById('inv_loading').classList.remove('hidden');
        
        this.listener = onSnapshot(q, (snapshot) => {
            this.data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
            this.render();
            document.getElementById('inv_loading').classList.add('hidden');
        });
        
        this.setupForm();
        this.setupImport();
    },

    render: function() {
        const tbody = document.getElementById('inv_tableBody');
        const filter = document.getElementById('inv_search').value.toLowerCase();
        
        const filtered = this.data.filter(item => 
            (item.item || '').toLowerCase().includes(filter) ||
            (item.notes || '').toLowerCase().includes(filter)
        );

        // Sort: Cabinet -> Shelf -> Item
        filtered.sort((a,b) => {
            if ((a.cabinet||'') < (b.cabinet||'')) return -1;
            if ((a.cabinet||'') > (b.cabinet||'')) return 1;
            if ((a.shelf||'') < (b.shelf||'')) return -1;
            if ((a.shelf||'') > (b.shelf||'')) return 1;
            return (a.item||'').localeCompare(b.item||'');
        });

        tbody.innerHTML = filtered.map(item => {
            // Format Date YYYY-MM-DD to MM/DD/YYYY
            let expDisplay = '-';
            if (item.earliestExpiration) {
                const parts = item.earliestExpiration.split('-');
                if (parts.length === 3) {
                    expDisplay = `${parts[1]}/${parts[2]}/${parts[0]}`;
                } else {
                    expDisplay = item.earliestExpiration;
                }
            }

            return `
            <tr class="hover:bg-gray-50 cursor-pointer text-sm" onclick="InventoryApp.openModal('${item.id}')">
                <td class="px-3 py-2 font-mono text-gray-600">${item.cabinet || '-'}-${item.shelf || '-'}</td>
                <td class="px-3 py-2 font-semibold text-gray-900">${item.item || '?'}</td>
                <td class="px-3 py-2 text-gray-700">${item.quantity ?? '-'}</td>
                <td class="px-3 py-2 ${this.checkExp(item.earliestExpiration)}">${expDisplay}</td>
                <td class="px-3 py-2 text-gray-500 truncate max-w-[150px]">${item.notes || ''}</td>
            </tr>
        `}).join('');
        
        if(filtered.length === 0) tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-400">No items found.</td></tr>`;
    },

    checkExp: function(dateStr) {
        if(!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const months3 = new Date(); months3.setMonth(now.getMonth() + 3);
        
        if(d < now) return 'text-red-600 font-bold'; // Expired
        if(d < months3) return 'text-orange-500 font-bold'; // Expiring soon
        return 'text-green-600';
    },

    setupForm: function() {
        // Cabinet Buttons
        document.getElementById('inv_cabinetButtons').addEventListener('click', (e) => {
            if(!e.target.classList.contains('inv-btn-choice')) return;
            document.querySelectorAll('#inv_cabinetButtons .inv-btn-choice').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white');
                b.classList.add('hover:bg-gray-100');
            });
            e.target.classList.remove('hover:bg-gray-100');
            e.target.classList.add('bg-blue-600', 'text-white');
            document.getElementById('inv_cabinet').value = e.target.dataset.value;
        });

        // Shelf Buttons
        document.getElementById('inv_shelfButtons').addEventListener('click', (e) => {
            if(!e.target.classList.contains('inv-btn-choice')) return;
            document.querySelectorAll('#inv_shelfButtons .inv-btn-choice').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white');
                b.classList.add('hover:bg-gray-100');
            });
            e.target.classList.remove('hover:bg-gray-100');
            e.target.classList.add('bg-blue-600', 'text-white');
            document.getElementById('inv_shelf').value = e.target.dataset.value;
        });

        document.getElementById('inv_search').addEventListener('input', () => this.render());
        document.getElementById('inv_clearBtn').addEventListener('click', () => this.clearForm());
        
        document.getElementById('inv_form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('inv_editDocId').value;
            const data = {
                cabinet: document.getElementById('inv_cabinet').value,
                shelf: document.getElementById('inv_shelf').value,
                item: document.getElementById('inv_item').value,
                quantity: Number(document.getElementById('inv_quantity').value),
                earliestExpiration: document.getElementById('inv_expiration').value,
                notes: document.getElementById('inv_notes').value,
                lastUpdated: serverTimestamp()
            };

            try {
                // UPDATED PATH
                const collectionRef = collection(db, getCollectionPath('supplies'));
                if(id) {
                    await setDoc(doc(db, getCollectionPath('supplies'), id), data, {merge:true});
                    this.logTransaction(data.item, 'Edit/Update', data.quantity);
                } else {
                    await addDoc(collectionRef, data);
                    this.logTransaction(data.item, 'New Item Added', data.quantity);
                }
                this.clearForm();
                this.showMsg('Saved!', false);
            } catch(err) {
                console.error(err);
                this.showMsg(err.message, true);
            }
        });
    },

    clearForm: function() {
        document.getElementById('inv_form').reset();
        document.getElementById('inv_editDocId').value = '';
        document.getElementById('inv_cabinet').value = '';
        document.getElementById('inv_shelf').value = '';
        document.querySelectorAll('.inv-btn-choice').forEach(b => {
            b.classList.remove('bg-blue-600', 'text-white');
            b.classList.add('hover:bg-gray-100');
        });
        document.getElementById('inv_submitBtn').textContent = 'Save';
    },

    openModal: function(id) {
        this.selectedItem = this.data.find(i => i.id === id);
        if(!this.selectedItem) return;
        document.getElementById('modal_item_name').textContent = this.selectedItem.item;
        document.getElementById('modal_action').classList.remove('hidden');
        document.getElementById('modal_action').classList.add('flex');
    },

    editFromModal: function() {
        const item = this.selectedItem;
        document.getElementById('inv_editDocId').value = item.id;
        document.getElementById('inv_item').value = item.item;
        document.getElementById('inv_quantity').value = item.quantity;
        document.getElementById('inv_expiration').value = item.earliestExpiration;
        document.getElementById('inv_notes').value = item.notes;
        
        // Set Buttons
        if(item.cabinet) {
            const btn = document.querySelector(`#inv_cabinetButtons button[data-value="${item.cabinet}"]`);
            if(btn) btn.click();
        }
        if(item.shelf) {
            const btn = document.querySelector(`#inv_shelfButtons button[data-value="${item.shelf}"]`);
            if(btn) btn.click();
        }

        document.getElementById('inv_submitBtn').textContent = 'Update';
        document.getElementById('modal_action').classList.add('hidden');
        document.getElementById('modal_action').classList.remove('flex');
    },

    deleteFromModal: function() {
        document.getElementById('modal_action').classList.add('hidden');
        document.getElementById('modal_action').classList.remove('flex');
        document.getElementById('modal_confirm').classList.remove('hidden');
        document.getElementById('modal_confirm').classList.add('flex');
    },

    confirmDelete: async function() {
        if(this.selectedItem) {
            // UPDATED PATH
            await deleteDoc(doc(db, getCollectionPath('supplies'), this.selectedItem.id));
            this.logTransaction(this.selectedItem.item, 'Deleted', 0);
            this.selectedItem = null;
        }
        document.getElementById('modal_confirm').classList.add('hidden');
        document.getElementById('modal_confirm').classList.remove('flex');
    },

    logTransaction: async function(item, reason, qty) {
        // UPDATED PATH
        await addDoc(collection(db, getCollectionPath('transactions')), {
            item: item,
            reason: reason,
            quantityTaken: qty,
            loggedAt: serverTimestamp(),
            person: currentUser ? currentUser.email : 'Anon'
        });
    },

    triggerImport: function() {
        document.getElementById('inv_importFile').click();
    },

    setupImport: function() {
        const fileInput = document.getElementById('inv_importFile');
        // Prevent multiple listeners if init runs twice by cloning
        const newHelper = fileInput.cloneNode(true);
        fileInput.parentNode.replaceChild(newHelper, fileInput);
        
        newHelper.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            this.showMsg('Reading file...', false);

            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    this.processImport(results.data);
                    e.target.value = ''; // Reset for next use
                },
                error: (err) => {
                    console.error("CSV Parse Error:", err);
                    this.showMsg('Error parsing CSV', true);
                }
            });
        });
    },

    processImport: async function(rows) {
        if (!rows || rows.length === 0) {
            this.showMsg('CSV is empty', true);
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        this.showMsg(`Importing ${rows.length} items...`, false);

        // Process sequentially or in parallel? Parallel is faster.
        const batchPromises = rows.map(async (row) => {
            // Flexible header matching
            const itemName = row['Item'] || row['item'] || row['ITEM'] || row['Name'] || row['name'];
            if (!itemName) {
                // Skip empty rows without counting as error, or count as error?
                // Usually just skip empty lines
                return; 
            }

            const quantity = Number(row['Qty'] || row['qty'] || row['Quantity'] || row['quantity'] || 0);
            const expiration = row['Exp'] || row['exp'] || row['Expiration'] || row['expiration'] || '';
            const cabinet = row['Cabinet'] || row['cabinet'] || row['Loc'] || '';
            const shelf = row['Shelf'] || row['shelf'] || '';
            const notes = row['Notes'] || row['notes'] || '';

            const newData = {
                cabinet: cabinet,
                shelf: shelf,
                item: itemName,
                quantity: isNaN(quantity) ? 0 : quantity,
                earliestExpiration: expiration,
                notes: notes,
                lastUpdated: serverTimestamp()
            };

            try {
                // Add to Supplies
                await addDoc(collection(db, getCollectionPath('supplies')), newData);
                
                // Log Transaction
                await addDoc(collection(db, getCollectionPath('transactions')), {
                    item: newData.item,
                    reason: 'CSV Import',
                    quantityTaken: newData.quantity,
                    loggedAt: serverTimestamp(),
                    person: currentUser ? currentUser.email : 'CSV Import'
                });
                
                successCount++;
            } catch (err) {
                console.error("Import Error for item:", itemName, err);
                errorCount++;
            }
        });

        await Promise.all(batchPromises);

        if (errorCount > 0) {
            this.showMsg(`Imported ${successCount} items. ${errorCount} failed.`, true);
        } else {
            this.showMsg(`Successfully imported ${successCount} items!`, false);
        }
    },

    exportCSV: function() {
        const csv = Papa.unparse(this.data.map(i => ({
            Cabinet: i.cabinet,
            Shelf: i.shelf,
            Item: i.item,
            Qty: i.quantity,
            Exp: i.earliestExpiration,
            Notes: i.notes
        })));
        this.downloadFile(csv, 'inventory_export.csv');
    },

    downloadFile: function(content, name) {
        const blob = new Blob([content], {type: 'text/csv;charset=utf-8;'});
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
    },
    
    showMsg: function(txt, err) {
        const el = document.getElementById('inv_message');
        el.textContent = txt;
        el.className = `p-2 text-sm text-center rounded ${err ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }
};

// Attach Modal Events
document.getElementById('modal_btn_edit').addEventListener('click', () => InventoryApp.editFromModal());
document.getElementById('modal_btn_delete').addEventListener('click', () => InventoryApp.deleteFromModal());
document.getElementById('modal_btn_cancel').addEventListener('click', () => {
    document.getElementById('modal_action').classList.add('hidden');
    document.getElementById('modal_action').classList.remove('flex');
});
document.getElementById('modal_conf_delete').addEventListener('click', () => InventoryApp.confirmDelete());
document.getElementById('modal_conf_cancel').addEventListener('click', () => {
     document.getElementById('modal_confirm').classList.add('hidden');
     document.getElementById('modal_confirm').classList.remove('flex');
});


/* ================= TRANSACTION MODULE ================= */
const TransactionApp = {
    listener: null,
    data: [],
    
    init: function() {
        if(this.listener) return;
        // UPDATED PATH
        const q = query(collection(db, getCollectionPath('transactions')), orderBy('loggedAt', 'desc'), limit(100));
        document.getElementById('trans_loading').classList.remove('hidden');
        
        this.listener = onSnapshot(q, (snap) => {
            this.data = snap.docs.map(d => d.data());
            this.render();
            document.getElementById('trans_loading').classList.add('hidden');
        });
        
        ['trans_search', 'trans_start', 'trans_end'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.render());
        });
    },

    getFilteredData: function() {
        const search = document.getElementById('trans_search').value.toLowerCase();
        const start = document.getElementById('trans_start').value;
        const end = document.getElementById('trans_end').value;

        return this.data.filter(t => {
            const d = t.loggedAt ? t.loggedAt.toDate() : new Date(0);
            const txtMatch = (t.item||'').toLowerCase().includes(search) || (t.reason||'').toLowerCase().includes(search);
            let dateMatch = true;
            if(start && d < new Date(start)) dateMatch = false;
            if(end) {
                const endDate = new Date(end);
                endDate.setHours(23,59,59);
                if(d > endDate) dateMatch = false;
            }
            return txtMatch && dateMatch;
        });
    },

    render: function() {
        const filtered = this.getFilteredData();

        document.getElementById('trans_tableBody').innerHTML = filtered.map(t => {
            const date = t.loggedAt ? t.loggedAt.toDate().toLocaleString() : 'N/A';
            return `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 text-gray-500 whitespace-nowrap">${date}</td>
                    <td class="p-3 font-medium text-gray-900">${t.item || '?'}</td>
                    <td class="p-3 text-gray-700">${t.quantityTaken || ''}</td>
                    <td class="p-3 text-gray-500">${t.reason || ''}</td>
                    <td class="p-3 text-gray-400 text-xs font-mono">${t.person || 'Anon'}</td>
                </tr>
            `;
        }).join('');
    },

    openReportModal: function() {
        const filtered = this.getFilteredData();
        const search = document.getElementById('trans_search').value;
        const start = document.getElementById('trans_start').value;
        const end = document.getElementById('trans_end').value;

        const html = this.generateReportHTML(filtered, search, start, end);
        document.getElementById('report_preview_body').innerHTML = html;
        document.getElementById('modal_report').classList.remove('hidden');
    },

    generateReportHTML: function(filteredData, search, start, end) {
        const now = new Date();
        const reportDate = now.toLocaleString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        
        let filterTextParts = [];
        if(search) filterTextParts.push(`Search: "${search}"`);
        if(start || end) filterTextParts.push(`Date Range: ${start || 'Start'} to ${end || 'Present'}`);
        
        const filterText = filterTextParts.length > 0 
            ? `Filters: ${filterTextParts.join(' | ')}` 
            : "Filters: Showing All Records";

        return `
            <div style="font-family: sans-serif; color: #333;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://i.ibb.co/WX2kv4q/logo750x750.png" style="max-height: 120px; margin: 0 auto 15px auto; display: block;">
                    <h2 style="font-size: 24px; font-weight: bold; margin: 0;">Supply Transaction Report</h2>
                    <p style="color: #666; font-size: 14px; margin-top: 5px;">Generated on: ${reportDate}</p>
                    <p style="color: #666; font-size: 14px; margin-top: 2px; font-style: italic;">${filterText}</p>
                    <p style="color: #333; font-size: 14px; font-weight: bold; margin-top: 5px;">Total Records: ${filteredData.length}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Date</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Item</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Qty Change</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Reason</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">User</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredData.map(t => {
                            const date = t.loggedAt ? t.loggedAt.toDate().toLocaleString() : 'N/A';
                            return `
                                <tr>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${date}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px; font-weight: bold;">${t.item || '?'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${t.quantityTaken || ''}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${t.reason || ''}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${t.person || 'Anon'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    downloadCSV: function() {
        const csv = Papa.unparse(this.data.map(t => ({
            Date: t.loggedAt ? t.loggedAt.toDate().toLocaleString() : '',
            Item: t.item,
            Qty: t.quantityTaken,
            Reason: t.reason,
            User: t.person
        })));
        InventoryApp.downloadFile(csv, 'transactions.csv');
    }
};

/* ================= DRUG BAG MODULE ================= */
const DrugBagApp = {
    listener: null,
    data: [],

    init: function() {
        if(this.listener) return;
        // UPDATED PATH
        const q = query(collection(db, getCollectionPath('exchanges')), orderBy('timestamp', 'desc'), limit(100));
        document.getElementById('db_loading').style.display = 'block';

        this.listener = onSnapshot(q, (snap) => {
            this.data = snap.docs.map(d => d.data());
            this.populateFilters();
            this.render();
            document.getElementById('db_loading').style.display = 'none';
        });

        document.getElementById('db_search').addEventListener('input', () => this.render());
        document.getElementById('db_facilityFilter').addEventListener('change', () => this.render());
        document.getElementById('db_startDate').addEventListener('change', () => this.render());
        document.getElementById('db_endDate').addEventListener('change', () => this.render());
    },

    populateFilters: function() {
        const facilities = [...new Set(this.data.map(i => i.facility).filter(Boolean))].sort();
        const sel = document.getElementById('db_facilityFilter');
        sel.innerHTML = '<option value="">All Facilities</option>' + facilities.map(f => `<option value="${f}">${f}</option>`).join('');
    },

    getFilteredData: function() {
        const search = document.getElementById('db_search').value.toLowerCase();
        const fac = document.getElementById('db_facilityFilter').value;
        const startDate = document.getElementById('db_startDate').value;
        const endDate = document.getElementById('db_endDate').value;

        return this.data.filter(i => {
            const txtMatch = (i.oldBagNumber||'').toLowerCase().includes(search) || (i.newBagNumber||'').toLowerCase().includes(search);
            const facMatch = !fac || i.facility === fac;
            let dateMatch = true;
            if(i.timestamp) {
                const d = i.timestamp.toDate ? i.timestamp.toDate() : new Date(i.timestamp);
                if (startDate) {
                    const start = new Date(startDate + 'T00:00:00');
                    if (d < start) dateMatch = false;
                }
                if (endDate) {
                    const end = new Date(endDate + 'T23:59:59');
                    if (d > end) dateMatch = false;
                }
            }
            return txtMatch && facMatch && dateMatch;
        });
    },

    render: function() {
        const filtered = this.getFilteredData();
        document.getElementById('db_tableBody').innerHTML = filtered.map(i => {
            const ts = i.timestamp && i.timestamp.toDate ? i.timestamp.toDate().toLocaleString() : 'N/A';
            return `
                <tr class="bg-white border-b hover:bg-gray-50">
                    <td class="px-6 py-4 whitespace-nowrap">${ts}</td>
                    <td class="px-6 py-4 font-mono text-gray-600">${i.oldBagNumber || '-'}</td>
                    <td class="px-6 py-4 font-mono font-bold text-blue-600">${i.newBagNumber || '-'}</td>
                    <td class="px-6 py-4 text-gray-600">${i.reason || '-'}</td>
                    <td class="px-6 py-4">${i.facility || '-'}</td>
                    <td class="px-6 py-4 text-xs text-gray-500">${i.submittedBy || ''}</td>
                </tr>
            `;
        }).join('');
    },

    generateReportHTML: function(filteredData, search, fac, start, end) {
        const now = new Date();
        const reportDate = now.toLocaleString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

        let filterTextParts = [];
        if(search) filterTextParts.push(`Bag Search: "${search}"`);
        if(fac) filterTextParts.push(`Facility: "${fac}"`);
        if(start || end) filterTextParts.push(`Date Range: ${start || 'Start'} to ${end || 'Present'}`);
        
        const filterText = filterTextParts.length > 0 
            ? `Filters: ${filterTextParts.join(' | ')}` 
            : "Filters: Showing All Records";

        return `
            <div style="font-family: sans-serif; color: #333;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://i.ibb.co/WX2kv4q/logo750x750.png" style="max-height: 120px; margin: 0 auto 15px auto; display: block;">
                    <h2 style="font-size: 24px; font-weight: bold; margin: 0;">Drug Bag Exchange Report</h2>
                    <p style="color: #666; font-size: 14px; margin-top: 5px;">Generated on: ${reportDate}</p>
                    <p style="color: #666; font-size: 14px; margin-top: 2px; font-style: italic;">${filterText}</p>
                    <p style="color: #333; font-size: 14px; font-weight: bold; margin-top: 5px;">Total Records: ${filteredData.length}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Timestamp</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Old Bag</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">New Bag</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Reason</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Facility</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Submitted By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredData.map(i => {
                            // 24-hour format for row timestamps
                            const ts = i.timestamp && i.timestamp.toDate 
                                ? i.timestamp.toDate().toLocaleString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) 
                                : 'N/A';
                            return `
                                <tr>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${ts}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.oldBagNumber || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px; font-weight: bold;">${i.newBagNumber || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.reason || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.facility || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.submittedBy || ''}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    openReportModal: function() {
        const filtered = this.getFilteredData();
        const search = document.getElementById('db_search').value;
        const fac = document.getElementById('db_facilityFilter').value;
        const start = document.getElementById('db_startDate').value;
        const end = document.getElementById('db_endDate').value;

        const html = this.generateReportHTML(filtered, search, fac, start, end);
        document.getElementById('report_preview_body').innerHTML = html;
        document.getElementById('modal_report').classList.remove('hidden');
    },

    // printFromModal is handled by the global window.printReportModal now
};

/* ================= OXYGEN MODULE ================= */
const OxygenApp = {
    listener: null,
    data: [],
    currentTab: 'main',

    init: function() {
        if(this.listener) return;
        // UPDATED PATH
        const q = query(collection(db, getCollectionPath('oxygen_logs')), orderBy("createdAt", "desc"), limit(50));
        document.getElementById('ox_loading').classList.remove('hidden');
        
        this.listener = onSnapshot(q, (snapshot) => {
            this.data = snapshot.docs.map(d => d.data());
            this.render();
            document.getElementById('ox_loading').classList.add('hidden');
        });
        
        document.getElementById('ox_search').addEventListener('input', () => this.render());
        document.getElementById('ox_startDate').addEventListener('change', () => this.render());
        document.getElementById('ox_endDate').addEventListener('change', () => this.render());
    },

    getFilteredData: function() {
        const search = document.getElementById('ox_search').value.toLowerCase();
        const startDate = document.getElementById('ox_startDate').value;
        const endDate = document.getElementById('ox_endDate').value;

        return this.data.filter(d => {
            // Search Text
            const content = (d.member || '' + d.portableNumber || '' + d.issues || '').toLowerCase();
            const txtMatch = content.includes(search);

            // Date Range
            let dateMatch = true;
            if(d.createdAt) {
                const date = d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt); // Handle both Timestamp and fallback
                if (startDate) {
                    const start = new Date(startDate + 'T00:00:00');
                    if (date < start) dateMatch = false;
                }
                if (endDate) {
                    const end = new Date(endDate + 'T23:59:59');
                    if (date > end) dateMatch = false;
                }
            }
            
            return txtMatch && dateMatch;
        });
    },

    render: function() {
        const filtered = this.getFilteredData();
        const mainTbody = document.getElementById('ox_mainTable');
        const portableTbody = document.getElementById('ox_portableTable');
        mainTbody.innerHTML = '';
        portableTbody.innerHTML = '';

        filtered.forEach(d => {
            const issueClass = (d.issues && d.issues.length > 1) ? "text-red-600 font-bold bg-red-50" : "text-gray-500";
            
            if(d.logType === 'Main Tank') {
                mainTbody.innerHTML += `
                    <tr class="hover:bg-gray-50 border-b">
                        <td class="px-4 py-3 whitespace-nowrap text-gray-700">${d.dateTime}</td>
                        <td class="px-4 py-3 font-medium">${d.member}</td>
                        <td class="px-4 py-3 font-bold text-blue-700">${d.newPsi || '-'}</td>
                        <td class="px-4 py-3 text-gray-600">${d.oldPsi || '-'}</td>
                        <td class="px-4 py-3 ${issueClass}">${d.issues || 'None'}</td>
                    </tr>
                `;
            } else {
                portableTbody.innerHTML += `
                    <tr class="hover:bg-gray-50 border-b">
                        <td class="px-4 py-3 whitespace-nowrap text-gray-700">${d.dateTime}</td>
                        <td class="px-4 py-3 font-bold text-green-700">${d.portableNumber || '-'}</td>
                        <td class="px-4 py-3 text-xs">PSI: ${d.cyl1Psi || '-'}</td>
                        <td class="px-4 py-3 text-xs">PSI: ${d.cyl2Psi || '-'}</td>
                        <td class="px-4 py-3 text-gray-600">${d.member}</td>
                    </tr>
                `;
            }
        });
    },

    switchTab: function(tabName) {
        this.currentTab = tabName;
        const mainTab = document.getElementById('ox-tab-main');
        const portTab = document.getElementById('ox-tab-portable');
        const mainView = document.getElementById('ox-view-main');
        const portView = document.getElementById('ox-view-portable');

        if(tabName === 'main') {
            // Styles
            mainTab.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
            mainTab.classList.remove('text-gray-500');
            portTab.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            portTab.classList.add('text-gray-500');
            
            // Visibility
            mainView.classList.remove('hidden');
            portView.classList.add('hidden');
        } else {
            // Styles
            portTab.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
            portTab.classList.remove('text-gray-500');
            mainTab.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            mainTab.classList.add('text-gray-500');

            // Visibility
            portView.classList.remove('hidden');
            mainView.classList.add('hidden');
        }
    },

    openReportModal: function() {
        // Filter based on active tab AND current filters
        const filteredAll = this.getFilteredData();
        const search = document.getElementById('ox_search').value;
        const start = document.getElementById('ox_startDate').value;
        const end = document.getElementById('ox_endDate').value;
        
        const filteredTab = filteredAll.filter(d => {
            if(this.currentTab === 'main') return d.logType === 'Main Tank';
            return d.logType !== 'Main Tank'; // Assume Portable
        });
        
        const html = this.generateReportHTML(filteredTab, search, start, end);
        document.getElementById('report_preview_body').innerHTML = html;
        document.getElementById('modal_report').classList.remove('hidden');
    },

    generateReportHTML: function(filteredData, search, start, end) {
        const now = new Date();
        const reportDate = now.toLocaleString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        const title = this.currentTab === 'main' ? 'Oxygen Tracker - Main Tank' : 'Oxygen Tracker - Portable Bottles';

        let filterTextParts = [];
        if(search) filterTextParts.push(`Search: "${search}"`);
        if(start || end) filterTextParts.push(`Date Range: ${start || 'Start'} to ${end || 'Present'}`);
        
        const filterText = filterTextParts.length > 0 
            ? `Filters: ${filterTextParts.join(' | ')}` 
            : "Filters: Showing All Records";

        let tableHead = '';
        if(this.currentTab === 'main') {
            tableHead = `
                <tr>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Date</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Member</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">New PSI</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Old PSI</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Issues</th>
                </tr>
            `;
        } else {
            tableHead = `
                <tr>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Date</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Bottle ID</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Cyl 1 PSI</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Cyl 2 PSI</th>
                    <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Member</th>
                </tr>
            `;
        }

        return `
            <div style="font-family: sans-serif; color: #333;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://i.ibb.co/WX2kv4q/logo750x750.png" style="max-height: 120px; margin: 0 auto 15px auto; display: block;">
                    <h2 style="font-size: 24px; font-weight: bold; margin: 0;">${title}</h2>
                    <p style="color: #666; font-size: 14px; margin-top: 5px;">Generated on: ${reportDate}</p>
                    <p style="color: #666; font-size: 14px; margin-top: 2px; font-style: italic;">${filterText}</p>
                    <p style="color: #333; font-size: 14px; font-weight: bold; margin-top: 5px;">Total Records: ${filteredData.length}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead style="background-color: #f3f4f6;">
                        ${tableHead}
                    </thead>
                    <tbody>
                        ${filteredData.map(d => {
                            if(this.currentTab === 'main') {
                                return `
                                    <tr>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.dateTime || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.member || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px; font-weight: bold;">${d.newPsi || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.oldPsi || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.issues || 'None'}</td>
                                    </tr>
                                `;
                            } else {
                                return `
                                    <tr>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.dateTime || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px; font-weight: bold;">${d.portableNumber || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.cyl1Psi || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.cyl2Psi || ''}</td>
                                        <td style="border: 1px solid #e5e7eb; padding: 8px;">${d.member || ''}</td>
                                    </tr>
                                `;
                            }
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },
    
    handleImport: function(e) {
        // ... removed previous import logic ...
    }
};

/* ================= DRUG DESTRUCTION MODULE ================= */
const DestructionApp = {
    listener: null,
    data: [],

    init: function() {
        if(this.listener) return;
        // UPDATED PATH
        const q = query(collection(db, getCollectionPath('drug_destruction_logs')), orderBy('date', 'desc'));
        document.getElementById('dest_loading').classList.remove('hidden');
        
        this.listener = onSnapshot(q, (snapshot) => {
            this.data = snapshot.docs.map(d => d.data());
            this.render();
            document.getElementById('dest_loading').classList.add('hidden');
        });
        
        document.getElementById('dest_startDate').addEventListener('change', () => this.render());
        document.getElementById('dest_endDate').addEventListener('change', () => this.render());
        
        // Setup Form Submit Listener
        document.getElementById('destructionForm').addEventListener('submit', (e) => this.handleSave(e));
    },

    getFilteredData: function() {
        const startDate = document.getElementById('dest_startDate').value;
        const endDate = document.getElementById('dest_endDate').value;

        return this.data.filter(d => {
            let matchesStart = true;
            let matchesEnd = true;

            if (startDate && d.date) matchesStart = d.date >= startDate;
            if (endDate && d.date) matchesEnd = d.date <= endDate;

            return matchesStart && matchesEnd;
        });
    },

    render: function() {
        const filtered = this.getFilteredData();
        const tbody = document.getElementById('dest_tableBody');
        document.getElementById('dest_recordCount').textContent = `Showing ${filtered.length} Record(s)`;
        tbody.innerHTML = '';

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-gray-500">No records found.</td></tr>`;
            return;
        }

        filtered.forEach(data => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';
            
            // Format Date YYYY-MM-DD -> MM/DD/YYYY
            let displayDate = data.date || '';
            if(displayDate.includes('-')) {
                const p = displayDate.split('-');
                if(p.length === 3) displayDate = `${p[1]}/${p[2]}/${p[0]}`;
            }

            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-gray-600 font-medium">${displayDate}</td>
                <td class="px-6 py-4 font-medium text-gray-900">${data.drugName || ''}</td>
                <td class="px-6 py-4 text-gray-600">${data.drugStrength || ''}</td>
                <td class="px-6 py-4 text-gray-600">
                    <span class="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs border border-gray-200">
                        ${data.dosageForm || ''}
                    </span>
                </td>
                <td class="px-6 py-4 text-gray-600">${data.quantity || ''}</td>
                <td class="px-6 py-4 text-gray-600 max-w-[150px] truncate" title="${data.disposalMethod || ''}">
                    ${data.disposalMethod || ''}
                </td>
                <td class="px-6 py-4 text-blue-600 font-medium">
                    ${data.professionalName || ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    clearFilters: function() {
        document.getElementById('dest_startDate').value = '';
        document.getElementById('dest_endDate').value = '';
        this.render();
    },

    openReportModal: function() {
        const filtered = this.getFilteredData();
        const startVal = document.getElementById('dest_startDate').value;
        const endVal = document.getElementById('dest_endDate').value;
        const html = this.generateReportHTML(filtered, startVal, endVal);
        document.getElementById('report_preview_body').innerHTML = html;
        document.getElementById('modal_report').classList.remove('hidden');
    },

    generateReportHTML: function(data, startDate, endDate) {
        const now = new Date();
        const reportDate = now.toLocaleString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

        // Date formatting helper
        const fmt = (d) => {
            if(!d) return '';
            const p = d.split('-');
            return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : d;
        };

        let dateRangeText = "Filters: Showing All Records";
        if (startDate && endDate) dateRangeText = `Date Range: ${fmt(startDate)} - ${fmt(endDate)}`;
        else if (startDate) dateRangeText = `Date Range: Since ${fmt(startDate)}`;
        else if (endDate) dateRangeText = `Date Range: Until ${fmt(endDate)}`;

        return `
            <div style="font-family: sans-serif; color: #333;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://i.ibb.co/WX2kv4q/logo750x750.png" style="max-height: 120px; margin: 0 auto 15px auto; display: block;">
                    <h2 style="font-size: 24px; font-weight: bold; margin: 0;">Drug Destruction Log Report</h2>
                    <p style="color: #666; font-size: 14px; margin-top: 5px;">Generated on: ${reportDate}</p>
                    <p style="color: #666; font-size: 14px; margin-top: 2px; font-style: italic;">${dateRangeText}</p>
                    <p style="color: #333; font-size: 14px; font-weight: bold; margin-top: 5px;">Total Records: ${data.length}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Date</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Drug Name</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Strength</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Form</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Qty</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Method</th>
                            <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left;">Professional</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(i => {
                            return `
                                <tr>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${fmt(i.date)}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px; font-weight: bold;">${i.drugName || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.drugStrength || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.dosageForm || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.quantity || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.disposalMethod || '-'}</td>
                                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${i.professionalName || ''}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },
    
    openEntryModal: function() {
        // Reset specific fields only or keep date/professional? 
        // Keeping Date and Professional is often better for workflow, so only reset drug details
        document.getElementById('dest_form_date').value = new Date().toISOString().split('T')[0];
        document.getElementById('dest_form_drug').value = '';
        document.getElementById('dest_form_strength').value = '';
        document.getElementById('dest_form_quantity').value = '';
        
        document.getElementById('modal_dest_entry').classList.remove('hidden');
        document.getElementById('modal_dest_entry').classList.add('flex');
    },
    
    closeEntryModal: function() {
        document.getElementById('modal_dest_entry').classList.add('hidden');
        document.getElementById('modal_dest_entry').classList.remove('flex');
    },
    
    handleSave: async function(e) {
        e.preventDefault();
        if(!currentUser) return;
        
        const btn = document.getElementById('dest_submitBtn');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = "Saving...";
        
        const formData = {
            date: document.getElementById('dest_form_date').value,
            professionalName: document.getElementById('dest_form_professional').value,
            drugName: document.getElementById('dest_form_drug').value,
            drugStrength: document.getElementById('dest_form_strength').value,
            quantity: document.getElementById('dest_form_quantity').value,
            dosageForm: document.getElementById('dest_form_form').value,
            disposalMethod: document.getElementById('dest_form_method').value,
            createdAt: serverTimestamp(),
            userId: currentUser.uid
        };
        
        try {
            // UPDATED PATH
            await addDoc(collection(db, getCollectionPath('drug_destruction_logs')), formData);
            this.showNotification("Record saved successfully!");
            this.closeEntryModal();
        } catch (err) {
            console.error("Error saving:", err);
            this.showNotification("Failed to save record.", "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    },
    
    showNotification: function(msg, type = 'success') {
        window.showNotification(msg, type); // Use Global
    }
};

// --- AUTO LOGOUT LOGIC ---
let inactivityTimeout;
const AUTO_LOGOUT_TIME = 30 * 60 * 1000; // 30 minutes in milliseconds

const resetInactivityTimer = () => {
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    if (!currentUser) return; // Don't start if not logged in

    inactivityTimeout = setTimeout(() => {
        if (currentUser) {
            console.log("User inactive for too long. Logging out...");
            handleLogout();
        }
    }, AUTO_LOGOUT_TIME);
};

const setupActivityListeners = () => {
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(event => {
        document.addEventListener(event, resetInactivityTimer, true);
    });
};

// Initialize listeners once
setupActivityListeners();

// --- AUTH & INIT ---
const initAuth = async () => {
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        try {
            await signInWithCustomToken(auth, __initial_auth_token);
        } catch(e) {
            console.error("Custom token auth failed", e);
        }
    }
};
initAuth();

onAuthStateChanged(auth, async (user) => {
    const loginView = document.getElementById('login-view');
    const sidebar = document.getElementById('sidebar');
    const mobileHeader = document.getElementById('mobile-header');
    const mainContent = document.querySelector('main');
    const statusEl = document.getElementById('userStatus');

    // SECURITY FIX: Prevent anonymous access
    if (user && user.isAnonymous) {
        await signOut(auth);
        return;
    }

    if (user) {
        // LOGGED IN
        currentUser = user;
        statusEl.textContent = user.email || `User: ${user.uid.slice(0,5)}...`;
        statusEl.classList.add('text-green-600');
        
        // Show App UI
        loginView.classList.add('login-fade-out');
        setTimeout(() => loginView.classList.add('hidden'), 500); // Allow fade animation
        
        sidebar.classList.remove('hidden');
        sidebar.classList.add('flex');
        mobileHeader.classList.remove('hidden');
        mobileHeader.classList.add('flex');
        mainContent.classList.remove('hidden');

        // Start Inactivity Timer
        resetInactivityTimer();

        // Initialize current view if needed
        if(Router.current === 'inventory') InventoryApp.init();
    } else {
        // LOGGED OUT
        currentUser = null;
        if (inactivityTimeout) clearTimeout(inactivityTimeout);

        statusEl.textContent = 'Not connected';
        
        // Show Login UI
        loginView.classList.remove('hidden');
        loginView.classList.remove('login-fade-out');
        
        // Hide App UI
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex');
        mobileHeader.classList.add('hidden');
        mobileHeader.classList.remove('flex');
        mainContent.classList.add('hidden');
    }
});

// Expose apps to window
window.InventoryApp = InventoryApp;
window.TransactionApp = TransactionApp;
window.DrugBagApp = DrugBagApp;
window.OxygenApp = OxygenApp;
window.DestructionApp = DestructionApp;

// Default Router State
Router.navigate('dashboard');