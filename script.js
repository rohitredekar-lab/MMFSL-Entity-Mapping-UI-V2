// --- Global State & Configuration ---
let fileHandle = null;
let activeId = null;
let activeType = null;
let expandedMappingId = null;
let expandedMappingType = null;
let filters = { region: '', state: '', circle: '', cluster: '', branch: '' };
let mappingFocus = 'both';
let isEditMode = false;
let history = [];
let isAppInitialized = false; // Guard for double-init
let isolatedColumn = null; // Track which column is currently isolated (full-screen)
let editingRoleEntityId = null; // Track entity open for role editing
let viewingUserMappingId = null; // Track user open in the mapping details drawer
let selectedEntityType = null; // Track entity type chosen from the selection overlay
let editingEntityTypeIdx = -1; // Track which createdEntityTypes entry is being updated
let excelData = null; // Store rows of selected sheet
let excelWorkbook = null; // Store parsed workbook
let excelHeaders = []; // Store headers of selected sheet
let excelMappings = {}; // Store mapping of system attributes to excel headers

const ENTITY_LABELS = {
    retail_branch: 'Retail Branch',
    atm: 'ATM'
};

const PREDEFINED_ROLES = {
    region: ['Regional Head', 'Zonal Manager', 'Compliance Officer'],
    state: ['State Head', 'State Operations Manager'],
    circle: ['Circle Manager'],
    cluster: ['Cluster Manager'],
    branch: ['Branch Manager', 'Branch Operations Manager', 'Cashier']
};

// Maps any custom hierarchy level name to its canonical data-type key
const GEO_LEVEL_MAP = {
    'Zone': 'region', 'Region': 'region',
    'State': 'state',
    'Circle': 'circle',
    'Cluster': 'cluster', 'Area': 'cluster',
    'Branch': 'branch', 'Hub': 'branch'
};

// All canonical column types in display order
const ALL_COLUMN_TYPES = ['region', 'state', 'circle', 'cluster', 'branch'];

const HOLIDAY_ENTITY_TYPES = ['Retail Branch', 'ATM'];
const HOLIDAY_GEO_LEVELS = ['Region', 'Circle', 'Cluster', 'Branch'];
const HOLIDAY_DEFAULTS = {
    weekendLabels: {
        holiday: 'Holiday',
        working: 'Working Day',
        configured: 'Configured Holiday',
        workingWeekend: 'Configured Working Weekend',
        special: 'Special Closure'
    }
};

const holidayState = {
    entityType: 'Retail Branch',
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    records: [],
    uploadFile: null,
    uploadErrors: [],
    listPage: 1,
    pageSize: 10,
    filters: {
        entityType: '',
        geographyLevel: '',
        geography: '',
        holidayType: '',
        status: 'All',
        search: ''
    },
    drawer: {
        visible: false,
        mode: 'create',
        date: null,
        defaultStatus: 'Working Day',
        selectedLevel: 'Region',
        selectedGeographies: []
    }
};

// Returns the createdEntityTypes entry matching the currently selected entity type
function getActiveEntityConfig() {
    if (!selectedEntityType) return null;
    const label = ENTITY_LABELS[selectedEntityType] || selectedEntityType;
    let config = (createdEntityTypes || []).find(et =>
        et.name === label ||
        et.name.toLowerCase().replace(/\s+/g, '_') === selectedEntityType
    );
    if (!config && createdEntityTypes.length > 0) config = createdEntityTypes[0];
    return config;
}

// Helper to get data for a specific level, either from config or global data
function getLevelData(type) {
    const config = getActiveEntityConfig();
    const dataKey = type === 'branch' ? 'branches' : type + 's';

    // If config has dynamic data, use it
    if (config && config.dynamicData && config.dynamicData[dataKey]) {
        return config.dynamicData[dataKey];
    }

    // Fallback to static mock data
    return data[dataKey] || [];
}

// Helper to get mappings, either from config or global data
function getMappings() {
    const config = getActiveEntityConfig();
    if (config && config.dynamicMappings) {
        return config.dynamicMappings;
    }
    return data.mappings;
}

/**
 * Syncs the Entity User Mapping columns to match the active entity type's
 * geoLevels. Columns for levels not in the hierarchy are hidden; column
 * headers are renamed to the level names defined in the entity config.
 * Also re-initialises DOM element references after visibility changes.
 */
function syncMappingColumnsToEntityType() {
    const config = getActiveEntityConfig();
    const container = document.querySelector('.mapping-container');
    if (!container) return;

    // Full hierarchy = defined levels + Branch (always the base)
    const hierarchyLevels = config ? [...config.geoLevels, 'Branch'] : ['Region', 'State', 'Circle', 'Cluster', 'Branch'];

    // Resolve each level name to its data-type key, dedup
    const seen = new Set();
    const activeTypes = [];
    hierarchyLevels.forEach(lvl => {
        const type = GEO_LEVEL_MAP[lvl] || lvl.toLowerCase();
        if (!seen.has(type)) { seen.add(type); activeTypes.push({ type, label: lvl }); }
    });

    ALL_COLUMN_TYPES.forEach(colType => {
        const col = container.querySelector(`.mapping-column[data-type="${colType}"]`);
        if (!col) return;

        const match = activeTypes.find(a => a.type === colType);
        col.style.display = match ? '' : 'none';

        if (match) {
            // Rename header to custom level name
            const span = col.querySelector('.column-header span');
            if (span) {
                const plural = match.label === 'Branch' ? 'Branches' : match.label + 's';
                span.textContent = plural;
            }
            // Update search placeholder
            const searchInput = col.querySelector('.column-search-input');
            if (searchInput) {
                const plural = match.label === 'Branch' ? 'Branches' : match.label + 's';
                searchInput.placeholder = `Search ${plural}...`;
            }
        }
    });

    // Adjust grid columns to occupy full width proportionally
    const visibleCount = activeTypes.length;
    if (container) {
        container.style.gridTemplateColumns = `repeat(${visibleCount}, 1fr)`;
    }

    // Rebuild lists reference to only include visible columns
    initDOMElements();
}

// Data is now loaded from data.js


// --- Initialization ---
function init() {
    console.log('MMFSL UI: Initializing Demo Data...');
    renderLists();
}

// --- State Management ---
function saveState() {
    history.push(JSON.parse(JSON.stringify(data)));
    if (history.length > 20) history.shift();
}

// --- DOM Elements ---
let lists, svg, deleteContainer;
function initDOMElements() {
    // Only include columns that are currently visible (synced to entity type)
    const allListIds = {
        region: 'regions-list',
        state: 'states-list',
        circle: 'circles-list',
        cluster: 'clusters-list',
        branch: 'branches-list'
    };
    lists = {};
    Object.entries(allListIds).forEach(([key, id]) => {
        const el = document.getElementById(id);
        const col = el && el.closest('.mapping-column');
        if (el && col && col.style.display !== 'none') {
            lists[key] = el;
        }
    });
    svg = document.getElementById('mapping-svg');
    deleteContainer = document.getElementById('delete-btn-container');

    Object.entries(lists).forEach(([k, v]) => { if (!v) console.warn(`Missing list element: ${k}-list`); });
}

// --- Icons ---
const getIconSVG = (type) => {
    const icons = {
        region: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle>',
        state: '<path d="M12 21 s-9-6-9-13a9 9 0 0 1 18 0c0 7-9 13-9 13z"></path><circle cx="12" cy="10" r="3"></circle>',
        circle: '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle>',
        cluster: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>',
        branch: '<path d="M3 21v-4a4 4 0 1 1 4 4H3z"></path><path d="M3 7V3a4 4 0 1 1 4 4H3z"></path><path d="M17 21v-4a4 4 0 1 1 4 4h-4z"></path><path d="M17 7V3a4 4 0 1 1 4 4h-4z"></path>'
    };
    return `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="#e41837" stroke-width="2">${icons[type]}</svg>`;
};

const formatCount = (count, singular, plural = singular + 's') => {
    return `${count} ${count === 1 ? singular : plural}`;
};

function getRegionHierarchyCounts(regionId) {
    const mappings = getMappings();
    const states = mappings.regionToState.filter(m => m.from === regionId).map(m => m.to);
    const circles = mappings.stateToCircle.filter(m => states.includes(m.from)).map(m => m.to);
    const clusters = mappings.circleToCluster.filter(m => circles.includes(m.from)).map(m => m.to);
    const branches = mappings.clusterToBranch.filter(m => clusters.includes(m.from)).map(m => m.to);
    return { states: states.length, circles: circles.length, clusters: clusters.length, branches: branches.length };
}

function getStateHierarchyCounts(stateId) {
    const mappings = getMappings();
    const circles = mappings.stateToCircle.filter(m => m.from === stateId).map(m => m.to);
    const clusters = mappings.circleToCluster.filter(m => circles.includes(m.from)).map(m => m.to);
    const branches = mappings.clusterToBranch.filter(m => clusters.includes(m.from)).map(m => m.to);
    return { circles: circles.length, clusters: clusters.length, branches: branches.length };
}

function getCircleHierarchyCounts(circleId) {
    const mappings = getMappings();
    const clusters = mappings.circleToCluster.filter(m => m.from === circleId).map(m => m.to);
    const branches = mappings.clusterToBranch.filter(m => clusters.includes(m.from)).map(m => m.to);
    return { clusters: clusters.length, branches: branches.length };
}

function getClusterHierarchyCounts(clusterId) {
    const mappings = getMappings();
    const branches = mappings.clusterToBranch.filter(m => m.from === clusterId).map(m => m.to);
    return { branches: branches.length };
}

function getBranchHierarchy(branchId) {
    const mappings = getMappings();
    const parents = mappings.clusterToBranch.filter(m => m.to === branchId).map(m => m.from);
    if (parents.length === 0) return 'Individual Branch';

    const clusterData = getLevelData('cluster');
    const clusterNames = clusterData.filter(c => parents.includes(c.id)).map(c => c.name);
    const count = clusterNames.length;
    if (count === 0) return 'Individual Branch';
    return `Part of: ${clusterNames[0]}${count > 1 ? ` (+${count - 1})` : ''}`;
}

// --- Rendering ---
function renderLists() {
    if (!lists) return;

    const mappingContainer = document.querySelector('.mapping-container');
    const viewModeToggle = document.querySelector('.view-mode-toggle');
    if (mappingContainer) {
        if (activeId || expandedMappingId) mappingContainer.classList.add('focus-mode');
        else mappingContainer.classList.remove('focus-mode');

        // Handle Isolation UI
        if (isolatedColumn) {
            mappingContainer.classList.add('isolation-active');
            document.querySelectorAll('.mapping-column').forEach(col => {
                col.classList.toggle('isolated', col.dataset.type === isolatedColumn);
            });
        } else {
            mappingContainer.classList.remove('isolation-active');
            document.querySelectorAll('.mapping-column').forEach(col => col.classList.remove('isolated'));
        }
    }

    // Hide View/Edit mode toggle when in user mapping mode or when a cell is expanded
    if (viewModeToggle) {
        const hideToggle = isolatedColumn || expandedMappingId;
        viewModeToggle.style.display = hideToggle ? 'none' : 'flex';
    }

    Object.keys(lists).forEach(type => {
        const listEl = lists[type];
        if (!listEl) return;

        // Conditional Scroll Locking for column with an expanded card
        const isColumnMapping = (expandedMappingId && expandedMappingType === type);
        listEl.classList.toggle('mapping-active', isColumnMapping);

        listEl.innerHTML = '';

        // --- RESTORE COLLAPSED HEADER STATE ---
        const colHeaderTitle = document.querySelector(`.mapping-column[data-type="${type}"] .column-header span`);
        const colHeaderActions = document.querySelector(`.mapping-column[data-type="${type}"] .column-header-actions`);

        if (colHeaderTitle) {
            if (isolatedColumn === type && editingRoleEntityId) {
                const levelData = getLevelData(type);
                const entity = levelData.find(e => e.id === editingRoleEntityId);
                colHeaderTitle.innerHTML = `Manage User Mapping: ${entity ? entity.name : ''}`;
            } else {
                colHeaderTitle.innerHTML = type.charAt(0).toUpperCase() + type.slice(1) + (type === 'branch' ? 'es' : 's');
            }
        }
        if (colHeaderActions) {
            if (isolatedColumn === type) {
                // When isolated, only show the Back button
                colHeaderActions.innerHTML = `
                    <button class="header-back-btn" title="Back" style="display:flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; padding:5px 10px; border-radius:6px; background:rgba(255,255,255,0.15); color:white; border:none; cursor:pointer; transition:background 0.2s;">
                        <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg> Back
                    </button>
                `;
                colHeaderActions.querySelector('.header-back-btn').onclick = (e) => {
                    e.stopPropagation();
                    if (editingRoleEntityId) {
                        editingRoleEntityId = null;
                        viewingUserMappingId = null;
                        renderLists();
                    } else {
                        toggleIsolation(type);
                    }
                };
            } else {
                colHeaderActions.innerHTML = `
                    <button class="user-mapping-btn" title="User Access Mapping" data-column="${type}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="8.5" cy="7" r="4"></circle>
                            <polyline points="17 11 19 13 23 9"></polyline>
                        </svg>
                    </button>
                `;
                colHeaderActions.querySelector('.user-mapping-btn').onclick = (e) => {
                    e.stopPropagation();
                    toggleIsolation(type);
                };
            }
        }

        // --- DIRECTION TOGGLES VISIBILITY ---
        const dirToggle = document.querySelector(`.mapping-column[data-type="${type}"] .direction-toggle`);
        if (dirToggle) {
            dirToggle.style.display = isolatedColumn ? 'none' : 'flex';
        }

        // --- ROLE EDITOR OVERRIDE ---
        const searchEl = document.querySelector(`.mapping-column[data-type="${type}"] .column-search`);

        if (isolatedColumn === type && editingRoleEntityId) {
            if (searchEl) searchEl.style.display = 'none'; // Hide generic branch search

            renderRoleEditor(listEl, type, editingRoleEntityId);
            return; // Skip normal rendering mapping cards for this column
        } else {
            if (searchEl) searchEl.style.display = 'block'; // Restore search
        }

        const levelData = getLevelData(type);
        const filteredData = (levelData || []).filter(item =>
            item.name.toLowerCase().includes((filters[type] || '').toLowerCase())
        );

        const col = document.querySelector(`.mapping-column[data-type="${type}"]`);
        const searchInput = col.querySelector('.column-search-input');
        const hadFocus = (document.activeElement === searchInput);
        const selectionStart = searchInput?.selectionStart;
        const selectionEnd = searchInput?.selectionEnd;

        const highlighted = getHighlightedMappings();
        const { ids } = highlighted;
        const mappingContainer = document.querySelector('.mapping-container');
        if (mappingContainer) {
            if (activeId) mappingContainer.classList.add('is-dimmed');
            else mappingContainer.classList.remove('is-dimmed');
        }

        // Dynamic Sorting: 
        // 1. Bring expanded mapping card to the very top.
        // 2. Bring active/highlighted (mapped) cards next.
        // 3. Keep rest in original order.
        const sortedData = [...filteredData].sort((a, b) => {
            if (a.id === expandedMappingId) return -1;
            if (b.id === expandedMappingId) return 1;

            const aHighlighted = ids.has(a.id);
            const bHighlighted = ids.has(b.id);
            if (aHighlighted && !bHighlighted) return -1;
            if (!aHighlighted && bHighlighted) return 1;

            return 0;
        });

        // Use DocumentFragment for performance
        const fragment = document.createDocumentFragment();

        sortedData.forEach(item => {
            let cardTitle = item.name;
            const isActive = activeId === item.id;
            const isExpanded = expandedMappingId === item.id;

            const card = document.createElement('div');
            card.className = `mapping-card ${isActive ? 'active' : ''} ${ids.has(item.id) && !isActive ? 'highlighted' : ''} ${isExpanded ? 'expanded' : ''}`;
            card.dataset.id = item.id;
            card.dataset.type = type;

            if (isExpanded) {
                // Render Expanded Mapping UI inside the card
                const targetConfigs = {
                    region: [{ type: 'state', label: 'States (Child)', dir: 'forward' }],
                    state: [{ type: 'region', label: 'Regions (Parent)', dir: 'backward' }, { type: 'circle', label: 'Circles (Child)', dir: 'forward' }],
                    circle: [{ type: 'state', label: 'States (Parent)', dir: 'backward' }, { type: 'cluster', label: 'Clusters (Child)', dir: 'forward' }],
                    cluster: [{ type: 'circle', label: 'Circles (Parent)', dir: 'backward' }, { type: 'branch', label: 'Branches (Child)', dir: 'forward' }],
                    branch: [{ type: 'cluster', label: 'Clusters (Parent)', dir: 'backward' }]
                };
                const configs = targetConfigs[type];
                let currentConfig = configs[0];
                const getPlural = (t) => t === 'branch' ? 'Branches' : (t.charAt(0).toUpperCase() + t.slice(1) + 's');

                card.innerHTML = `
                    <div class="inline-mapping-header">
                        <div class="selector-title">Map <strong>${item.name}</strong> to:</div>
                        <button class="close-selector-btn" title="Close Mapping">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="selector-header">
                        ${configs.length > 1 ? `<div class="selector-tabs">${configs.map((c, i) => `<div class="selector-tab ${i === 0 ? 'active' : ''}" data-index="${i}">${getPlural(c.type)}</div>`).join('')}</div>` : ''}
                        <input type="text" class="selector-search" placeholder="Search ${getPlural(currentConfig.type)}..." autofocus>
                    </div>
                    <div class="selector-list"></div>
                `;

                const searchInput = card.querySelector('.selector-search');
                const listContainer = card.querySelector('.selector-list');
                const tabs = card.querySelectorAll('.selector-tab');
                const closeBtn = card.querySelector('.close-selector-btn');

                const renderInlineItems = (filter = '') => {
                    listContainer.innerHTML = '';
                    const targets = getLevelData(currentConfig.type);
                    const mappings = getMappings();

                    const checkMapping = (targetId) => {
                        let mappingKey = '';
                        let fromId = item.id, toId = targetId, fType = type, tType = currentConfig.type;
                        if (fType === 'region' && tType === 'state') mappingKey = 'regionToState';
                        else if (fType === 'state' && tType === 'region') { mappingKey = 'regionToState';[fromId, toId] = [toId, fromId]; }
                        else if (fType === 'state' && tType === 'circle') mappingKey = 'stateToCircle';
                        else if (fType === 'circle' && tType === 'state') { mappingKey = 'stateToCircle';[fromId, toId] = [toId, fromId]; }
                        else if (fType === 'circle' && tType === 'cluster') mappingKey = 'circleToCluster';
                        else if (fType === 'cluster' && tType === 'circle') { mappingKey = 'circleToCluster';[fromId, toId] = [toId, fromId]; }
                        else if (fType === 'cluster' && tType === 'branch') mappingKey = 'clusterToBranch';
                        else if (fType === 'branch' && tType === 'cluster') { mappingKey = 'clusterToBranch';[fromId, toId] = [toId, fromId]; }
                        return mappingKey && mappings[mappingKey].some(m => m.from === fromId && m.to === toId);
                    };

                    targets.filter(t => t.name.toLowerCase().includes(filter.toLowerCase())).forEach(target => {
                        const isMapped = checkMapping(target.id);
                        const addIcon = `<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                        const checkIcon = `<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                        const row = document.createElement('div');
                        row.className = 'selector-item';
                        row.innerHTML = `<span>${target.name}</span><button class="selector-toggle-btn ${isMapped ? 'toggle-remove' : 'toggle-add'}" title="${isMapped ? 'Remove' : 'Add'}">${isMapped ? checkIcon : addIcon}</button>`;

                        const btn = row.querySelector('.selector-toggle-btn');
                        btn.onclick = (e) => {
                            e.stopPropagation();
                            if (isMapped) {
                                let fId = item.id, tId = target.id, fType = type, tType = currentConfig.type;
                                if (fType === 'state' && tType === 'region') { [fId, tId] = [tId, fId];[fType, tType] = [tType, fType]; }
                                if (fType === 'circle' && tType === 'state') { [fId, tId] = [tId, fId];[fType, tType] = [tType, fType]; }
                                if (fType === 'cluster' && tType === 'circle') { [fId, tId] = [tId, fId];[fType, tType] = [tType, fType]; }
                                if (fType === 'branch' && tType === 'cluster') { [fId, tId] = [tId, fId];[fType, tType] = [tType, fType]; }
                                deleteMapping(fType, tType, fId, tId);
                            } else {
                                createMapping(item.id, type, target.id, currentConfig.type);
                            }
                            renderInlineItems(searchInput.value);
                        };
                        listContainer.appendChild(row);
                    });
                };

                const titleEl = card.querySelector('.selector-title');
                const updateTitle = () => {
                    const plural = getPlural(currentConfig.type);
                    const itemType = type.charAt(0).toUpperCase() + type.slice(1);
                    if (currentConfig.dir === 'forward') {
                        titleEl.innerHTML = `Map <strong>${plural}</strong> to <strong>${item.name}</strong> ${itemType}`;
                    } else {
                        titleEl.innerHTML = `Map <strong>${item.name}</strong> ${itemType} to <strong>${plural}</strong>`;
                    }
                };

                tabs.forEach(tab => {
                    tab.onclick = (e) => {
                        e.stopPropagation();
                        tabs.forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        currentConfig = configs[parseInt(tab.dataset.index)];
                        searchInput.placeholder = `Search ${getPlural(currentConfig.type)}...`;
                        updateTitle();
                        renderInlineItems(searchInput.value);
                    };
                });

                updateTitle();

                searchInput.onclick = (e) => e.stopPropagation();
                searchInput.oninput = (e) => renderInlineItems(e.target.value);
                closeBtn.onclick = (e) => { e.stopPropagation(); closeMappingSelector(); };

                renderInlineItems();
            } else {
                // Render Normal Card Content
                let subtitle = '';
                if (type === 'region') {
                    const counts = getRegionHierarchyCounts(item.id);
                    subtitle = `${formatCount(counts.states, 'State')}, ${formatCount(counts.circles, 'Circle')}, ${formatCount(counts.clusters, 'Cluster')}, ${formatCount(counts.branches, 'Branch', 'Branches')}`;
                } else if (type === 'state') {
                    const counts = getStateHierarchyCounts(item.id);
                    subtitle = `${formatCount(counts.circles, 'Circle')}, ${formatCount(counts.clusters, 'Cluster')}, ${formatCount(counts.branches, 'Branch', 'Branches')}`;
                } else if (type === 'circle') {
                    const counts = getCircleHierarchyCounts(item.id);
                    subtitle = `${formatCount(counts.clusters, 'Cluster')}, ${formatCount(counts.branches, 'Branch', 'Branches')}`;
                } else if (type === 'cluster') {
                    const counts = getClusterHierarchyCounts(item.id);
                    subtitle = formatCount(counts.branches, 'Branch', 'Branches');
                } else {
                    if (type === 'branch') {
                        if (item.attributes?.['Entity Name'] || item.attributes?.['Branch Name']) {
                            cardTitle = item.attributes['Entity Name'] || item.attributes['Branch Name'];
                        } else if (selectedEntityType === 'retail_branch') {
                            cardTitle = item.name.replace(/\s*\(.*?\)\s*/, '').trim();
                        }
                    }

                    let solId = item.attributes?.['Branch Code'] || '';
                    let entNameDisplay = (type === 'branch' && item.attributes?.['Branch Name']) ? item.attributes['Branch Name'] : item.name;

                    // Specific Handling for Retail Branch (Mock Data fallback)
                    if (selectedEntityType === 'retail_branch' && type === 'branch' && !solId) {
                        const match = item.name.match(/\((.*?)\)/);
                        if (match) {
                            solId = match[1];
                            entNameDisplay = item.name.replace(/\s*\(.*?\)\s*/, '').trim();
                        }
                    }

                    if (solId || (entNameDisplay && entNameDisplay !== cardTitle)) {
                        subtitle = `<span style="color:#e41837; font-weight:600;">${solId}</span> ${(entNameDisplay && entNameDisplay !== cardTitle) ? ' • ' + entNameDisplay : ''}`;
                    } else {
                        subtitle = getBranchHierarchy(item.id);
                    }
                }

                const mappings = getMappings();
                const userCount = mappings.userRoles ? mappings.userRoles.filter(m => m.entityId === item.id).length : 0;
                const userBadgeHTML = userCount > 0 ? `<div class="card-user-badge" title="${userCount} Users Assigned"><svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle></svg> ${userCount}</div>` : '';


                card.innerHTML = `
                    <div class="card-icon">${getIconSVG(type)}</div>
                    <div class="card-content">
                        <div class="card-title">${cardTitle}</div>
                        <div class="card-subtitle-row">
                            <span class="card-subtitle">${subtitle}</span>
                            ${userBadgeHTML}
                        </div>
                    </div>
                    <div class="card-actions">
                        ${(isEditMode && type !== 'branch') ? `
                        <button class="add-mapping-btn" title="Add Mapping">
                            <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>` : ''}
                    </div>
                `;

                if (isEditMode) {
                    const btn = card.querySelector('.add-mapping-btn');
                    if (btn) {
                        btn.addEventListener('click', (e) => { e.stopPropagation(); showMappingSelector(item.id, type, e); });
                    }
                }
            }

            card.addEventListener('click', (e) => {
                handleCardClick(item.id, type);
            });
            card.draggable = isEditMode;
            card.addEventListener('dragstart', (e) => {
                if (!isEditMode) { e.preventDefault(); return; }
                e.dataTransfer.setData('text/plain', JSON.stringify({ id: item.id, type: type }));
                card.classList.add('dragging');
                activeId = item.id;
                activeType = type;
                renderLists();
            });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));
            card.addEventListener('dragover', (e) => { if (isEditMode) e.preventDefault(); });
            card.addEventListener('drop', (e) => {
                if (!isEditMode) return;
                e.preventDefault(); e.stopPropagation();
                const source = JSON.parse(e.dataTransfer.getData('text/plain'));
                createMapping(source.id, source.type, item.id, type);
            });
            fragment.appendChild(card);
        });

        listEl.innerHTML = '';
        listEl.appendChild(fragment);

        // Restore focus if needed
        if (hadFocus && searchInput) {
            searchInput.focus();
            if (selectionStart !== null) {
                searchInput.setSelectionRange(selectionStart, selectionEnd);
            }
        }
    });
    requestAnimationFrame(drawConnections);
}

function showMappingSelector(id, type, event) {
    if (expandedMappingId === id) {
        expandedMappingId = null;
        expandedMappingType = null;
    } else {
        activeId = id;
        activeType = type;
        expandedMappingId = id;
        expandedMappingType = type;
    }
    renderLists();
}

function closeMappingSelector() {
    const card = document.querySelector('.mapping-card.expanded');
    if (card) {
        card.classList.add('closing');
        // Wait for the exit animation (300ms) before re-rendering the list
        setTimeout(() => {
            expandedMappingId = null;
            expandedMappingType = null;
            renderLists();
        }, 300);
    } else {
        expandedMappingId = null;
        expandedMappingType = null;
        renderLists();
    }
}

function handleCardClick(id, type) {
    // Intercept clicks in Isolation Mode to open the Role Editor
    if (isolatedColumn === type) {
        if (editingRoleEntityId === id) {
            editingRoleEntityId = null;
        } else {
            editingRoleEntityId = id;
        }
        renderLists();
        return;
    }

    const prevActiveId = activeId;
    if (activeId === id) {
        activeId = null;
        activeType = null;
    } else {
        activeId = id;
        activeType = type;
    }

    // Scroll locking removed to ensure full navigability during mapping

    renderLists();

    // Smooth scroll into view if card is not fully visible after re-render
    if (activeId && activeId !== prevActiveId) {
        setTimeout(() => {
            const activeCard = document.querySelector(`.mapping-card.active[data-id="${activeId}"]`);
            if (activeCard) {
                const list = activeCard.closest('.column-list');
                const isVisible = (
                    activeCard.offsetTop >= list.scrollTop &&
                    (activeCard.offsetTop + activeCard.offsetHeight) <= (list.scrollTop + list.offsetHeight)
                );

                if (!isVisible) {
                    activeCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }

            // Also scroll highlighted connections into view smoothly
            const { ids } = getHighlightedMappings();
            ids.forEach(highlightId => {
                const el = document.querySelector(`.mapping-card.highlighted[data-id="${highlightId}"]`);
                if (el) {
                    const list = el.closest('.column-list');
                    const isVisible = (
                        el.offsetTop >= list.scrollTop &&
                        (el.offsetTop + el.offsetHeight) <= (list.scrollTop + list.offsetHeight)
                    );
                    if (!isVisible) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            });
        }, 100);
    }
}

function createMapping(fromId, fromType, toId, toType) {
    saveState();
    let mappingKey = '';
    if (fromType === 'region' && toType === 'state') mappingKey = 'regionToState';
    if (fromType === 'state' && toType === 'region') { mappingKey = 'regionToState';[fromId, toId] = [toId, fromId]; }
    if (fromType === 'state' && toType === 'circle') mappingKey = 'stateToCircle';
    if (fromType === 'circle' && toType === 'state') { mappingKey = 'stateToCircle';[fromId, toId] = [toId, fromId]; }
    if (fromType === 'circle' && toType === 'cluster') mappingKey = 'circleToCluster';
    if (fromType === 'cluster' && toType === 'circle') { mappingKey = 'circleToCluster';[fromId, toId] = [toId, fromId]; }
    if (fromType === 'cluster' && toType === 'branch') mappingKey = 'clusterToBranch';
    if (fromType === 'branch' && toType === 'cluster') { mappingKey = 'clusterToBranch';[fromId, toId] = [toId, fromId]; }
    if (mappingKey) {
        const mappings = getMappings();
        const exists = mappings[mappingKey].some(m => m.from === fromId && m.to === toId);
        if (!exists) { mappings[mappingKey].push({ from: fromId, to: toId }); renderLists(); }
    }
}

function deleteMapping(fromType, toType, fromId, toId) {
    saveState();
    let mappingKey = '';
    if (fromType === 'region' && toType === 'state') mappingKey = 'regionToState';
    if (fromType === 'state' && toType === 'circle') mappingKey = 'stateToCircle';
    if (fromType === 'circle' && toType === 'cluster') mappingKey = 'circleToCluster';
    if (fromType === 'cluster' && toType === 'branch') mappingKey = 'clusterToBranch';
    if (mappingKey) {
        const mappings = getMappings();
        mappings[mappingKey] = mappings[mappingKey].filter(m => !(m.from === fromId && m.to === toId));
        renderLists();
    }
}

function getHighlightedMappings() {
    if (!activeId) return { ids: new Set(), paths: new Set() };
    const ids = new Set([activeId]);
    const paths = new Set();
    const showForward = (mappingFocus === 'both' || mappingFocus === 'forward');
    const showBackward = (mappingFocus === 'both' || mappingFocus === 'backward');

    const mappings = getMappings();
    // Separate backward and forward passes to prevent sibling highlighting
    if (showBackward) {
        let currentIds = new Set([activeId]);
        let changed = true;
        while (changed) {
            let startSize = currentIds.size;
            // Upward: Branch -> Cluster -> Circle -> State -> Region
            mappings.clusterToBranch.forEach(m => { if (currentIds.has(m.to)) { currentIds.add(m.from); paths.add(`${m.from}-${m.to}`); ids.add(m.from); } });
            mappings.circleToCluster.forEach(m => { if (currentIds.has(m.to)) { currentIds.add(m.from); paths.add(`${m.from}-${m.to}`); ids.add(m.from); } });
            mappings.stateToCircle.forEach(m => { if (currentIds.has(m.to)) { currentIds.add(m.from); paths.add(`${m.from}-${m.to}`); ids.add(m.from); } });
            mappings.regionToState.forEach(m => { if (currentIds.has(m.to)) { currentIds.add(m.from); paths.add(`${m.from}-${m.to}`); ids.add(m.from); } });
            if (currentIds.size === startSize) changed = false;
        }
    }

    if (showForward) {
        let currentIds = new Set([activeId]);
        let changed = true;
        while (changed) {
            let startSize = currentIds.size;
            // Downward: Region -> State -> Circle -> Cluster -> Branch
            mappings.regionToState.forEach(m => { if (currentIds.has(m.from)) { currentIds.add(m.to); paths.add(`${m.from}-${m.to}`); ids.add(m.to); } });
            mappings.stateToCircle.forEach(m => { if (currentIds.has(m.from)) { currentIds.add(m.to); paths.add(`${m.from}-${m.to}`); ids.add(m.to); } });
            mappings.circleToCluster.forEach(m => { if (currentIds.has(m.from)) { currentIds.add(m.to); paths.add(`${m.from}-${m.to}`); ids.add(m.to); } });
            mappings.clusterToBranch.forEach(m => { if (currentIds.has(m.from)) { currentIds.add(m.to); paths.add(`${m.from}-${m.to}`); ids.add(m.to); } });
            if (currentIds.size === startSize) changed = false;
        }
    }

    return { ids, paths };
}

function drawConnections() {
    if (!svg || !deleteContainer) return;
    svg.innerHTML = '';
    deleteContainer.innerHTML = '';

    // Hide lines for custom entity types (unless user explicitly wants them)
    const config = getActiveEntityConfig();
    if (config && config.name !== 'Retail Branch') return;

    const container = document.querySelector('.mapping-container');
    if (!container) return;

    // Reset canvas to container size
    svg.setAttribute('height', container.offsetHeight);
    svg.setAttribute('width', container.offsetWidth);

    // Hide all mappings unless a card is active/selected OR if in isolation mode
    if (!activeId || isolatedColumn) return;

    const highlighted = getHighlightedMappings();

    // Performance optimization: Instead of iterating thousands of mappings,
    // only iterate over the highlighted (active) paths.
    highlighted.paths.forEach(pathKey => {
        const [fromId, toId] = pathKey.split('-');

        // Find cards for this path across all potential type pairs
        const typePairs = [
            ['region', 'state'],
            ['state', 'circle'],
            ['circle', 'cluster'],
            ['cluster', 'branch']
        ];

        for (const [fType, tType] of typePairs) {
            const fromCard = document.querySelector(`[data-id="${fromId}"][data-type="${fType}"]`);
            const toCard = document.querySelector(`[data-id="${toId}"][data-type="${tType}"]`);

            if (fromCard && toCard) {
                drawCurve(fromCard, toCard, true, fType, tType, fromId, toId);
                break; // Found the connection cards, move to next path
            }
        }
    });
}

function drawCurve(fromEl, toEl, isActive, fromType, toType, fromId, toId) {
    const fromList = fromEl.closest('.column-list');
    const toList = toEl.closest('.column-list');
    if (!fromList || !toList) return;

    const fromListRect = fromList.getBoundingClientRect();
    const toListRect = toList.getBoundingClientRect();
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    const getAnchorY = (el) => {
        const rect = el.getBoundingClientRect();
        const header = el.querySelector('.inline-mapping-header');
        if (header) {
            const hRect = header.getBoundingClientRect();
            return hRect.top + hRect.height / 2;
        }
        const icon = el.querySelector('.card-icon');
        if (icon) {
            const iRect = icon.getBoundingClientRect();
            return iRect.top + iRect.height / 2;
        }
        return rect.top + 28;
    };

    const y1_raw = getAnchorY(fromEl);
    const y2_raw = getAnchorY(toEl);

    // Check visibility in vertical columns
    const isFromVisible = (y1_raw >= fromListRect.top - 5 && y1_raw <= fromListRect.bottom + 5);
    const isToVisible = (y2_raw >= toListRect.top - 5 && y2_raw <= toListRect.bottom + 5);

    if (!isFromVisible || !isToVisible) return;

    const svgRect = svg.getBoundingClientRect();
    const x1 = fromRect.right - svgRect.left;
    const y1 = y1_raw - svgRect.top;
    const x2 = toRect.left - svgRect.left;
    const y2 = y2_raw - svgRect.top;

    const midX = x1 + (x2 - x1) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `connection-path ${isActive ? 'active' : ''}`);
    svg.appendChild(path);

    if (isEditMode && isActive && deleteContainer) {
        const midY = (y1 + y2) / 2;
        const btn = document.createElement('button');
        btn.className = 'delete-mapping-btn';
        btn.innerHTML = '&times;';
        btn.style.left = `${midX}px`;
        btn.style.top = `${midY}px`;
        btn.onclick = (e) => { e.stopPropagation(); deleteMapping(fromType, toType, fromId, toId); };
        deleteContainer.appendChild(btn);
    }
}

// --- Toggles & Search ---
function bindEvents() {
    document.querySelectorAll('.dir-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            mappingFocus = btn.dataset.dir;
            document.querySelectorAll('.dir-btn').forEach(b => b.classList.toggle('active', b === btn));
            renderLists();
        };
    });

    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            isEditMode = (btn.dataset.mode === 'edit');
            document.querySelectorAll('.mapping-column').forEach(col => col.classList.toggle('edit-active', isEditMode));
            renderLists();
        };
    });

    document.querySelectorAll('.column-search-input').forEach(input => {
        const type = input.closest('.mapping-column').dataset.type;
        input.oninput = (e) => { filters[type] = e.target.value; renderLists(); };
    });

    // --- Sync Mappings on Row Scroll & Global Vertical Scroll ---
    let rafId;
    document.querySelectorAll('.column-list').forEach(list => {
        list.addEventListener('scroll', () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(drawConnections);
        });
    });

    const mappingContainer = document.querySelector('.mapping-container');
    if (mappingContainer) {
        mappingContainer.addEventListener('scroll', () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(drawConnections);
        });
    }


    const exportBtn = document.querySelector('.export-btn');
    const saveBtn = document.querySelector('.save-btn');
    if (exportBtn) exportBtn.onclick = () => { alert('Exporting dashboard data...'); };
    if (saveBtn) saveBtn.onclick = () => { alert('Changes saved to local session!'); };

    // --- Column Isolation ---
    document.querySelectorAll('.user-mapping-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const type = btn.dataset.column;
            toggleIsolation(type);
        };
    });

    window.addEventListener('resize', () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(drawConnections);
    });

    // --- Global User Search Logic ---
    const globalSearchInput = document.getElementById('global-user-search-input');
    const globalSearchResults = document.getElementById('global-user-search-results');

    if (globalSearchInput) {
        globalSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query.length < 2) {
                globalSearchResults.classList.remove('active');
                return;
            }

            const results = systemUsers.filter(u =>
                u.name.toLowerCase().includes(query) ||
                u.empId.toLowerCase().includes(query)
            ).slice(0, 10);

            if (results.length > 0) {
                globalSearchResults.innerHTML = results.map(user => `
                    <div class="search-result-item" data-id="${user.id}">
                        <div class="res-avatar">${user.name.charAt(0)}</div>
                        <div class="res-info">
                            <div class="res-name">${user.name}</div>
                            <div class="res-meta" style="flex-direction: column; gap: 4px; align-items: flex-start;">
                                <div style="display: flex; gap: 8px;">
                                    <span>SAP: ${user.empId}</span>
                                    <span class="res-badge">${user.designations ? user.designations[0] : 'User'}</span>
                                </div>
                                
                            </div>
                        </div>
                    </div>
                `).join('');
                globalSearchResults.classList.add('active');

                globalSearchResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.onclick = () => {
                        const userId = item.dataset.id;
                        openGlobalUserModal(userId);
                        globalSearchResults.classList.remove('active');
                        globalSearchInput.value = '';
                    };
                });
            } else {
                globalSearchResults.innerHTML = '<div style="padding:15px; font-size:12px; color:#666; text-align:center;">No users found.</div>';
                globalSearchResults.classList.add('active');
            }
        });

        // Hide search results on click outside
        document.addEventListener('click', (e) => {
            if (!globalSearchInput.contains(e.target) && !globalSearchResults.contains(e.target)) {
                globalSearchResults.classList.remove('active');
            }
        });
    }
}

function openGlobalUserModal(userId) {
    const user = systemUsers.find(u => u.id === userId);
    if (!user) return;

    const modal = document.getElementById('global-user-modal');
    const body = document.getElementById('global-user-modal-body');

    // Find all mappings for this user
    const assignments = data.mappings.userRoles.filter(m => m.userId === userId);

    let mappingHTML = '';
    if (assignments.length === 0) {
        mappingHTML = '<div style="padding:20px; text-align:center; color:#666; font-size:13px;">No active mappings found for this user.</div>';
    } else {
        assignments.forEach(m => {
            let entityName = 'Unknown';
            let entityType = 'Geography';
            for (let typeKey of ['regions', 'states', 'circles', 'clusters', 'branches']) {
                const e = data[typeKey].find(item => item.id === m.entityId);
                if (e) {
                    entityName = e.name;
                    entityType = typeKey.slice(0, -1);
                    break;
                }
            }
            mappingHTML += `
                <div class="mapping-record" style="margin: 0 20px 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
                    <div style="margin-bottom:6px;"><span class="badge role">${m.role}</span></div>
                    <div class="mapping-entity" style="font-size:13px; font-weight:600;">
                        <span class="badge type">${entityType}</span> ${entityName}
                    </div>
                </div>
            `;
        });
    }

    body.innerHTML = `
        <div class="ticket-container" style="border-radius: 24px; background: white; overflow: hidden; position: relative;">
            <div class="details-header" style="position: absolute; top: 16px; right: 16px; z-index: 10;">
                <button class="close-modal-btn" style="width: 32px; height: 32px; padding: 0; background: rgba(0,0,0,0.25); border: none; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; line-height: 1;">&times;</button>
            </div>
            <div class="user-profile-cover" style="height: 120px; width: 100%;"></div>
            <div class="details-profile" style="margin-top:-50px; padding-bottom:20px; display: flex; flex-direction: column; align-items: center; text-align: center;">
                <div class="profile-avatar-wrapper" style="padding: 6px; background:white; border-radius:50%; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <div class="user-avatar xl" style="width: 80px; height: 80px; font-size: 36px; background: #111827;">${user.name.charAt(0)}</div>
                </div>
                <h2 class="details-name" style="margin:15px 0 8px 0; font-size: 22px;">${user.name}</h2>
                <div class="details-badges" style="display:flex; flex-direction:column; gap:8px; align-items:center;">
                    <div style="display:flex; gap:10px;">
                        <span class="user-meta-badge">SAP: ${user.empId}</span>
                        <span class="user-meta-badge">${user.designations ? user.designations[0] : 'Member'}</span>
                    </div>
                    <span class="user-meta-badge" style="background: rgba(228, 24, 55, 0.05); color: var(--primary-theme); border: 1px solid rgba(228, 24, 55, 0.1);">
                        <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                        ${user.empId}@finaryatech.com
                    </span>
                </div>
            </div>
            <div class="ticket-separator" style="position: relative; border-top: 2px dashed #e5e7eb; margin: 0;">
                <div style="position: absolute; top: -16px; left: -16px; width: 32px; height: 32px; background: rgba(0,0,0,0.4); border-radius: 50%; z-index: 2;"></div>
                <div style="position: absolute; top: -16px; right: -16px; width: 32px; height: 32px; background: rgba(0,0,0,0.4); border-radius: 50%; z-index: 2;"></div>
            </div>
            <div style="padding: 20px 24px; height: 200px; overflow-y: auto; background: transparent; pointer-events: auto;">
                <h4 style="margin:0 0 16px 0; font-size:12px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.05em;">Assignments</h4>
                ${mappingHTML}
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    modal.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.onclick = () => { modal.style.display = 'none'; };
    });

    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };
}

function toggleIsolation(type) {
    if (isolatedColumn === type) {
        isolatedColumn = null; // Exit isolation
    } else {
        isolatedColumn = type; // Enter isolation for specific column
        // When isolating, we should clear active mappings for visual clarity
        activeId = null;
        activeType = null;
        expandedMappingId = null;
        expandedMappingType = null;
        editingRoleEntityId = null; // Clear role editor state on toggle
    }
    renderLists();
}

// --- User Role Editor ---
function renderRoleEditor(container, type, entityId) {
    if (type === 'region') {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; height:100%; min-height:400px; align-items:center; justify-content:center; background: white; color: #374151; text-align:center; border-radius: 8px; margin: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="width:48px; height:48px; margin-bottom:12px;">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <div style="font-weight:600; font-size:16px; color: #111;">No Org level found</div>
                <div style="font-size:13px; margin-top:6px; color: #6b7280; max-width: 200px;"></div>
            </div>
        `;
        return;
    }

    const dataKey = type === 'branch' ? 'branches' : type + 's';
    const entity = data[dataKey].find(e => e.id === entityId);
    if (!entity) return;

    const roles = PREDEFINED_ROLES[type] || [];
    let activeRole = roles[0];
    let searchQuery = '';

    const renderEditorContent = () => {
        container.innerHTML = `
            <div class="role-editor-wrapper">
                <div class="role-tabs">
                    ${roles.map(role => {
            const count = data.mappings.userRoles.filter(m => m.role === role && m.entityId === entityId).length;
            return `<button class="role-tab ${role === activeRole ? 'active' : ''}" data-role="${role}">
                            ${role} ${count > 0 ? `<span class="role-count-badge">${count}</span>` : ''}
                        </button>`;
        }).join('')}
                </div>

                <div class="role-editor-body ${viewingUserMappingId ? 'show-details' : ''}">
                    <!-- Left: User Selection -->
                    <div class="role-users-section">
                        <div class="search-wrapper">
                            <input type="text" placeholder="Search System Users..." class="user-search-input" value="${searchQuery}">
                        </div>
                        <div class="user-list"></div>
                    </div>

                    <!-- Right: Context Panel (Overwritable profile vs nearby list) -->
                    <div class="role-context-section"></div>
                </div>
            </div>
        `;

        // Bind Tab Events
        container.querySelectorAll('.role-tab').forEach(tab => {
            tab.onclick = () => {
                activeRole = tab.dataset.role;
                renderEditorContent();
            };
        });

        // Bind Search
        const searchInput = container.querySelector('.user-search-input');
        searchInput.oninput = (e) => {
            searchQuery = e.target.value.toLowerCase();
            renderUsers(); // only trigger user re-render so we don't lose focus
        };
        // Ensure focus returns to end of input if re-rendered while typing
        if (searchQuery) {
            searchInput.focus();
            searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }

        const renderUsers = () => {
            const userListEl = container.querySelector('.user-list');
            userListEl.innerHTML = '';

            const roleDeptMap = {
                'Circle Manager': 'Circle Management',
                'Cluster Manager': 'Cluster Management',
                'Branch Manager': 'Branch Management',
                'Branch Operations Manager': 'Branch Operations',
                'BOM': 'Branch Operations',
                'Cashier': 'Branch Operations',
                'State Head': 'State Management',
                'State Operations Manager': 'State Operations'
            };
            const targetDept = roleDeptMap[activeRole];

            let filteredUsers = systemUsers.filter(u => {
                // Must match the role selected in the tabs via the designations array
                if (!u.designations || !u.designations.includes(activeRole)) return false;

                // Search filter
                const q = searchQuery.toLowerCase();
                return u.name.toLowerCase().includes(q) || u.empId.toLowerCase().includes(q);
            });

            // Sort to bring assigned users to the very top
            filteredUsers.sort((a, b) => {
                const aAssigned = data.mappings.userRoles.some(m => m.userId === a.id && m.role === activeRole && m.entityId === entityId);
                const bAssigned = data.mappings.userRoles.some(m => m.userId === b.id && m.role === activeRole && m.entityId === entityId);
                if (aAssigned && !bAssigned) return -1;
                if (!aAssigned && bAssigned) return 1;
                return 0;
            });

            filteredUsers.forEach(user => {
                const isAssigned = data.mappings.userRoles.some(m => m.userId === user.id && m.role === activeRole && m.entityId === entityId);
                const allUserAssignments = data.mappings.userRoles.filter(m => m.userId === user.id);

                const viewDetailsBtnHTML = `
                    <button class="view-mapping-btn">
                        View Mapping <span class="view-mapping-count">${allUserAssignments.length}</span>
                    </button>
                `;



                const userCard = document.createElement('div');
                userCard.className = `user-card ${isAssigned ? 'assigned' : ''} ${viewingUserMappingId === user.id ? 'viewing-active' : ''}`;
                userCard.innerHTML = `
                    <div class="user-info">
                        <div class="user-avatar">${user.name.charAt(0)}</div>
                        <div class="user-details">
                            <div class="user-name-row">
                                <div class="user-name">${user.name}</div>
                            </div>
                            <div class="user-emp-id">${user.empId} ${isAssigned ? `<span class="active-role-tag">• Assigned</span>` : `• ${activeRole}`}</div>
                            
                            <div class="user-card-actions" style="margin-top: 6px;">
                                ${viewDetailsBtnHTML}
                            </div>
                        </div>
                    </div>
                    <button class="assign-user-btn ${isAssigned ? 'revoke' : 'assign'}">
                        ${isAssigned ? 'Revoke' : 'Assign'}
                    </button>
                `;

                // Bind View Mapping Button
                const viewBtn = userCard.querySelector('.view-mapping-btn');
                if (viewBtn) {
                    viewBtn.onclick = () => {
                        viewingUserMappingId = user.id;
                        renderEditorContent();
                    };
                }

                // Bind Assign/Revoke
                userCard.querySelector('.assign-user-btn').onclick = () => {
                    if (isAssigned) {
                        data.mappings.userRoles = data.mappings.userRoles.filter(m => !(m.userId === user.id && m.role === activeRole && m.entityId === entityId));
                    } else {
                        data.mappings.userRoles.push({ userId: user.id, role: activeRole, entityId: entityId });
                    }
                    renderEditorContent();
                };
                userListEl.appendChild(userCard);
            });
        };

        const renderUserDetails = () => {
            const contextSection = container.querySelector('.role-context-section');
            if (!viewingUserMappingId) return;

            const user = systemUsers.find(u => u.id === viewingUserMappingId);
            if (!user) return;

            const allAssignments = data.mappings.userRoles.filter(m => m.userId === user.id);

            let HTML = `
                <div style="padding: 24px;">
                    <div class="ticket-wrapper" style="background: white; border-radius: 16px; box-shadow: 0 12px 28px rgba(0,0,0,0.06); position: relative; overflow: hidden; border: 1px solid #f0f0f0;">
                        <!-- Elevated Floating Close Button over Cover -->
                        <button class="ticket-close-btn close-details-btn" title="Close Profile" style="position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; padding: 0; background: rgba(0,0,0,0.25); backdrop-filter: blur(4px); border: none; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, transform 0.2s; z-index: 10;" onmouseover="this.style.background='rgba(0,0,0,0.5)'; this.style.transform='scale(1.05)';" onmouseout="this.style.background='rgba(0,0,0,0.25)'; this.style.transform='scale(1)';">
                            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin: 0; display: block;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        
                        <!-- Top Half of Ticket -->
                        <div class="user-profile-cover" style="height: 100px; background: linear-gradient(135deg, var(--primary-theme), #b91c1c); width: 100%;"></div>
                        <div class="details-profile" style="padding: 0 20px 24px; display: flex; flex-direction: column; align-items: center; text-align: center; margin-top: -46px;">
                            <div class="profile-avatar-wrapper" style="background: white; padding: 6px; border-radius: 50%; margin-bottom: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.06);">
                                <div class="user-avatar xl" style="width: 76px; height: 76px; font-size: 32px; background: #111827; border: 1px solid #f3f4f6;">${user.name.charAt(0)}</div>
                            </div>
                            <div class="details-name" style="font-size: 20px; font-weight: 700; color: #111; margin: 0 0 12px 0; letter-spacing: -0.01em;">${user.name}</div>
                            <div class="details-badges" style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center;">
                                <div style="display: flex; gap: 8px;">
                                    <span class="user-meta-badge"><svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> ${user.empId}</span>
                                    <span class="user-meta-badge"><svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg> ${user.department}</span>
                                </div>
                                <span class="user-meta-badge" style="background: rgba(228, 24, 55, 0.05); color: var(--primary-theme); border: 1px solid rgba(228, 24, 55, 0.1);">
                                    <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                                    ${user.empId}@finaryatech.com
                                </span>
                            </div>
                        </div>

                        <!-- Ticket Cutout Separator -->
                        <div class="ticket-separator" style="position: relative; border-top: 2px dashed #e5e7eb; margin: 0;">
                            <div style="position: absolute; top: -14px; left: -14px; width: 28px; height: 28px; background: #f9fafb; border-radius: 50%; box-shadow: inset -2px 0px 4px rgba(0,0,0,0.03); z-index: 2; border-right: 1px solid #f0f0f0;"></div>
                            <div style="position: absolute; top: -14px; right: -14px; width: 28px; height: 28px; background: #f9fafb; border-radius: 50%; box-shadow: inset 2px 0px 4px rgba(0,0,0,0.03); z-index: 2; border-left: 1px solid #f0f0f0;"></div>
                        </div>

                        <!-- Bottom Half of Ticket -->
                        <div class="details-mapping-list" style="padding: 24px 20px; background: #fffcfc; max-height: 350px; overflow-y: auto; pointer-events: auto;">
                            <h4 class="mapping-section-title" style="margin: 0 0 16px 0; font-size: 13px; font-weight: 700; color: #111; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;">
                                Active Mapping 
                                <span style="background: var(--primary-theme); color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">${allAssignments.length}</span>
                            </h4>
            `;

            if (allAssignments.length === 0) {
                HTML += `<div class="no-mappings">No active mapping found.</div>`;
            } else {
                allAssignments.forEach(m => {
                    let entityName = 'Unknown Entity';
                    let entityGroupName = 'Geography';
                    for (let typeKey of ['regions', 'states', 'circles', 'clusters', 'branches']) {
                        const e = data[typeKey].find(item => item.id === m.entityId);
                        if (e) {
                            entityName = e.name;
                            entityGroupName = typeKey.slice(0, -1);
                            break;
                        }
                    }
                    HTML += `
                        <div class="mapping-record" style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); transition: transform 0.2s, box-shadow 0.2s;">
                            <div class="mapping-role"><span class="badge role">${m.role}</span></div>
                            <div class="mapping-entity">
                                <span class="badge type">${entityGroupName}</span> ${entityName}
                            </div>
                        </div>
                    `;
                });
            }

            HTML += `
                        </div>
                    </div>
                </div>
            `;
            contextSection.innerHTML = HTML;

            // Bind Close Event
            contextSection.querySelector('.close-details-btn').onclick = () => {
                viewingUserMappingId = null;
                renderEditorContent();
            };
        };

        const renderNearby = () => {
            const contextSection = container.querySelector('.role-context-section');

            // Logic to find nearby siblings and parent name
            let siblings = [];
            let parentName = '';
            let parentType = '';
            if (type === 'branch') {
                const parentClusterId = data.mappings.clusterToBranch.find(m => m.to === entityId)?.from;
                if (parentClusterId) {
                    const parentEntity = data.clusters.find(c => c.id === parentClusterId);
                    parentName = parentEntity ? parentEntity.name : '';
                    parentType = 'Cluster';
                    const siblingBranchIds = data.mappings.clusterToBranch.filter(m => m.from === parentClusterId && m.to !== entityId).map(m => m.to);
                    siblings = data.branches.filter(b => siblingBranchIds.includes(b.id));
                }
            } else if (type === 'cluster') {
                const parentId = data.mappings.circleToCluster.find(m => m.to === entityId)?.from;
                if (parentId) {
                    const parentEntity = data.circles.find(c => c.id === parentId);
                    parentName = parentEntity ? parentEntity.name : '';
                    parentType = 'Circle';
                    const siblingIds = data.mappings.circleToCluster.filter(m => m.from === parentId && m.to !== entityId).map(m => m.to);
                    siblings = data.clusters.filter(b => siblingIds.includes(b.id));
                }
            } else if (type === 'circle') {
                const parentId = data.mappings.stateToCircle.find(m => m.to === entityId)?.from;
                if (parentId) {
                    const parentEntity = data.states.find(s => s.id === parentId);
                    parentName = parentEntity ? parentEntity.name : '';
                    parentType = 'State';
                    const siblingIds = data.mappings.stateToCircle.filter(m => m.from === parentId && m.to !== entityId).map(m => m.to);
                    siblings = data.circles.filter(b => siblingIds.includes(b.id));
                }
            } else if (type === 'state') {
                const parentId = data.mappings.regionToState.find(m => m.to === entityId)?.from;
                if (parentId) {
                    const parentEntity = data.regions.find(r => r.id === parentId);
                    parentName = parentEntity ? parentEntity.name : '';
                    parentType = 'Region';
                    const siblingIds = data.mappings.regionToState.filter(m => m.from === parentId && m.to !== entityId).map(m => m.to);
                    siblings = data.states.filter(b => siblingIds.includes(b.id));
                }
            }

            const pluralLabel = type === 'branch' ? 'Branches' : (type.charAt(0).toUpperCase() + type.slice(1) + 's');
            const singularLabel = type.charAt(0).toUpperCase() + type.slice(1);
            const typeLabel = siblings.length === 1 ? singularLabel : pluralLabel;
            const subtitle = parentName
                ? `${typeLabel} in ${parentType}: <strong>${parentName}</strong>`
                : `Nearby ${typeLabel}`;

            contextSection.innerHTML = `
                <div style="padding: 20px;">
                    <h3 style="margin: 0 0 4px 0; font-size: 16px;">${typeLabel} in same ${parentType || 'Group'}</h3>
                    <p class="section-desc" style="margin: 0 0 16px 0; font-size: 12px; color: #6b7280;">${subtitle}</p>
                    <div class="nearby-list"></div>
                </div>
            `;
            const nearbyListEl = contextSection.querySelector('.nearby-list');

            if (siblings.length === 0) {
                nearbyListEl.innerHTML = '<div class="no-nearby">No other entities found in this group.</div>';
                return;
            }

            siblings.forEach(sibling => {
                const siblingUsers = data.mappings.userRoles.filter(m => m.entityId === sibling.id && m.role === activeRole);
                const assignedCount = siblingUsers.length;

                const siblingItem = document.createElement('div');
                siblingItem.className = 'nearby-item';
                siblingItem.innerHTML = `
                    <div class="nearby-info">
                        <div class="nearby-name">${sibling.name}</div>
                        <div class="nearby-status">${assignedCount} User(s) Assigned to this role</div>
                    </div>
                `;

                const editSiblingBtn = document.createElement('button');
                editSiblingBtn.className = 'edit-sibling-btn';
                editSiblingBtn.innerHTML = 'Switch <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
                editSiblingBtn.onclick = () => {
                    editingRoleEntityId = sibling.id;
                    renderLists();
                };
                siblingItem.appendChild(editSiblingBtn);
                nearbyListEl.appendChild(siblingItem);
            });
        };

        renderUsers();
        if (viewingUserMappingId) {
            renderUserDetails();
        } else {
            renderNearby();
        }
    };

    renderEditorContent();
}

// --- Entity Selection Overlay Logic ---
function initEntitySelectOverlay() {
    const overlay = document.getElementById('entity-select-overlay');
    const confirmBtn = document.getElementById('entity-select-confirm-btn');
    const hiddenInput = document.getElementById('entity-type-select');

    // --- Custom dropdown wiring ---
    const wrapper = document.getElementById('custom-select-wrapper');
    const trigger = document.getElementById('custom-select-trigger');
    const valueEl = document.getElementById('custom-select-value');
    const optsList = document.getElementById('custom-select-options');

    if (!overlay || !confirmBtn || !wrapper || !trigger || !optsList) return;

    // Toggle open/close
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.toggle('open');
        trigger.setAttribute('aria-expanded', isOpen);
    });

    // Option selection
    optsList.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = opt.dataset.value;
            const label = opt.textContent.trim();

            // Update hidden input & display
            hiddenInput.value = val;
            valueEl.textContent = label;

            // Mark selected
            optsList.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');

            // Style trigger as "has value"
            wrapper.classList.add('has-value');
            wrapper.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');

            // Enable Proceed button
            confirmBtn.disabled = false;
        });
    });

    // Close on outside click
    document.addEventListener('click', () => {
        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    });

    // Keyboard: close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            wrapper.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    confirmBtn.addEventListener('click', () => {
        if (!hiddenInput.value) return;
        selectedEntityType = hiddenInput.value;

        // Animate overlay out
        overlay.classList.add('hiding');
        setTimeout(() => { showPage('main-page-box'); injectEntityBadge(); }, 380);
    });
}

function injectEntityBadge() {
    const titleEl = document.querySelector('.mapping-title h1');
    if (!titleEl) return;
    // Remove existing badge if any
    const existing = titleEl.querySelector('.entity-type-badge');
    if (existing) existing.remove();

    const label = ENTITY_LABELS[selectedEntityType] || selectedEntityType;
    const badge = document.createElement('button');
    badge.className = 'entity-type-badge';
    badge.title = 'Click to change entity type';
    badge.innerHTML = `
        ${label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;">
            <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
    `;
    badge.addEventListener('click', () => showEntityOverlayAgain());
    titleEl.appendChild(badge);
}

function showEntityOverlayAgain() {
    activeId = null; activeType = null;
    expandedMappingId = null; expandedMappingType = null;
    isolatedColumn = null; editingRoleEntityId = null; viewingUserMappingId = null;
    showPage('entity-select-overlay');
    resetEntityOverlay();
}
// =========================================================
// PAGE NAVIGATION HELPER
// =========================================================
const PAGES = ['demo-landing-page', 'entity-select-overlay', 'main-page-box', 'create-entity-page', 'list-entity-page', 'upload-user-page', 'entity-upload-page', 'entity-master-upload-page', 'holiday-calendar-page', 'holiday-list-page', 'holiday-upload-page', 'view-entity-page', 'update-entity-page'];

function showPage(pageId) {
    PAGES.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(pageId);
    if (!target) return;
    if (pageId === 'main-page-box' || pageId.startsWith('holiday-')) {
        target.style.display = 'flex';
    }
    else if (pageId === 'demo-landing-page') target.style.display = 'grid';
    else target.style.display = 'block';
    if (pageId === 'main-page-box') syncMappingColumnsToEntityType();
}

// =========================================================
// NAVIGATION — Administration > Touchpoints submenu
// =========================================================
function initNavigation() {
    const navCreateEntity = document.getElementById('nav-create-entity');
    const navEntityMapping = document.getElementById('nav-entity-mapping');
    const navEntityUpload = document.getElementById('nav-entity-upload');
    const navEntityMasterUpload = document.getElementById('nav-entity-master-upload');
    const navUploadUsers = document.getElementById('nav-upload-users');
    const adminPanel = document.getElementById('admin-dropdown-panel');
    const adminChevron = document.getElementById('admin-chevron');

    function closeAdminPanel() {
        if (adminPanel) adminPanel.classList.remove('open');
        if (adminChevron) adminChevron.classList.remove('rotated');
    }

    if (navCreateEntity) {
        navCreateEntity.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            resetCetForm();
            showPage('create-entity-page');
        });
    }

    if (navEntityMapping) {
        navEntityMapping.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            // If an entity type is already selected go directly to mapping page (synced)
            showPage('main-page-box');
            populateHeaderEntitySelect();
            syncMappingColumnsToEntityType();
            renderLists();
        });
    }

    if (navEntityUpload) {
        navEntityUpload.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            showPage('entity-upload-page');
        });
    }

    if (navEntityMasterUpload) {
        navEntityMasterUpload.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            resetEntityMasterPage();
            showPage('entity-master-upload-page');
        });
    }

    const navHolidayCalendar = document.getElementById('nav-holiday-calendar');
    const navHolidayList = document.getElementById('nav-holiday-list');
    const navHolidayUpload = document.getElementById('nav-holiday-upload');

    if (navHolidayCalendar) {
        navHolidayCalendar.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            initHolidayFilters();
            renderHolidayCalendar();
            showPage('holiday-calendar-page');
        });
    }

    if (navHolidayList) {
        navHolidayList.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            initHolidayFilters();
            renderHolidayList();
            showPage('holiday-list-page');
        });
    }

    if (navHolidayUpload) {
        navHolidayUpload.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            initHolidayFilters();
            showPage('holiday-upload-page');
        });
    }

    if (navUploadUsers) {
        navUploadUsers.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            resetUserUploadPage();
            showPage('upload-user-page');
        });
    }

    const navListEntity = document.getElementById('nav-list-entity');
    if (navListEntity) {
        navListEntity.addEventListener('click', function (e) {
            e.preventDefault();
            closeAdminPanel();
            showMasterAssessmentEntityList();
        });
    }

    // "Create New" button on list page
    const btnAddNew = document.getElementById('btn-add-entity-type-from-list');
    if (btnAddNew) {
        btnAddNew.addEventListener('click', () => {
            resetCetForm();
            showPage('create-entity-page');
        });
    }
}

function normalizeUserUploadHeader(header) {
    const normalized = String(header || '').trim().toLowerCase();
    const aliases = {
        'user login id': 'User Login ID',
        'login id': 'User Login ID',
        'loginid': 'User Login ID',
        'user login': 'User Login ID',
        'user name': 'User Name',
        'name': 'User Name',
        'user email id': 'User Email ID',
        'email id': 'User Email ID',
        'email': 'User Email ID',
        'user email': 'User Email ID'
    };
    return aliases[normalized] || header;
}

function createUserUploadTemplate() {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
        ['User Login ID', 'User Name', 'User Email ID'],
        ['demo.user', 'Demo User', 'demo.user@company.com']
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'User Upload');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MMFSL_User_Upload_Template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function renderUserUploadPreview(rows) {
    const body = document.getElementById('user-upload-preview-body');
    const summary = document.getElementById('user-upload-summary');
    const status = document.getElementById('user-upload-status');

    if (!body) return;

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="4" style="padding:16px 14px; color:#6b7280;">No data available yet.</td></tr>';
        if (summary) summary.textContent = 'No users loaded.';
        if (status) status.textContent = 'No file selected yet.';
        return;
    }

    body.innerHTML = rows.map((row, index) => `
        <tr>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${index + 1}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${row.loginId}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${row.userName}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${row.emailId}</td>
        </tr>
    `).join('');

    if (summary) summary.textContent = `${rows.length} user${rows.length === 1 ? '' : 's'} ready to upload`;
    if (status) status.textContent = `${rows.length} user${rows.length === 1 ? '' : 's'} parsed successfully.`;
}

// =========================================================
// ENTITY UPLOAD (MASTER) PAGE HELPERS
// =========================================================
function initEntityMasterUploadPage() {
    const select = document.getElementById('entity-master-entity-select');
    if (!select) return;
    select.innerHTML = '<option value="">Select Entity Type</option>';
    (createdEntityTypes || []).forEach(et => {
        const opt = document.createElement('option');
        opt.value = et.name.toLowerCase().replace(/\s+/g, '_');
        opt.textContent = et.name;
        select.appendChild(opt);
    });
    select.addEventListener('change', function () {
        renderEntityMasterFields(this.value);
        const dl = document.getElementById('entity-master-download-template-btn');
        if (dl) dl.disabled = !this.value;
    });

    const dlBtn = document.getElementById('entity-master-download-template-btn');
    if (dlBtn) dlBtn.addEventListener('click', createEntityMasterTemplate);

    const fileInput = document.getElementById('entity-master-file-input');
    if (fileInput) fileInput.addEventListener('change', handleEntityMasterFileInput);

    const uploadBtn = document.getElementById('entity-master-upload-btn');
    if (uploadBtn) uploadBtn.addEventListener('click', function () {
        const status = document.getElementById('entity-master-status');
        if (status) status.textContent = 'Upload processed (mock).';
    });
}

function resetEntityMasterPage() {
    const select = document.getElementById('entity-master-entity-select'); if (select) select.value = '';
    const fields = document.getElementById('entity-master-fields'); if (fields) fields.textContent = 'Select an entity type to view required fields.';
    const fileName = document.getElementById('entity-master-file-name'); if (fileName) { fileName.style.display = 'none'; fileName.textContent = ''; }
    const dl = document.getElementById('entity-master-download-template-btn'); if (dl) dl.disabled = true;
    const uploadBtn = document.getElementById('entity-master-upload-btn'); if (uploadBtn) uploadBtn.disabled = true;
    const status = document.getElementById('entity-master-status'); if (status) status.textContent = 'Select an entity type to begin.';
}

function renderEntityMasterFields(val) {
    const fieldsEl = document.getElementById('entity-master-fields');
    if (!fieldsEl) return;
    if (!val) { fieldsEl.textContent = 'Select an entity type to view required fields.'; return; }
    const headers = ['Sol ID', 'Region', 'Circle', 'Cluster', 'Branch Name'];
    fieldsEl.innerHTML = headers.map(h => `<span style="background:#fff; border:1px solid #e5e7eb; padding:8px 12px; border-radius:8px; font-weight:700;">${h}</span>`).join('');
}

function createEntityMasterTemplate() {
    const select = document.getElementById('entity-master-entity-select');
    if (!select || !select.value) return;
    const headers = ['Sol ID', 'Region', 'Circle', 'Cluster', 'Branch Name'];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([headers]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Template');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = select.options[select.selectedIndex].text.replace(/\s+/g, '_');
    a.download = `MMFSL_${name}_Entity_Template.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function handleEntityMasterFileInput(e) {
    const file = e.target.files && e.target.files[0];
    const nameEl = document.getElementById('entity-master-file-name');
    const uploadBtn = document.getElementById('entity-master-upload-btn');
    const status = document.getElementById('entity-master-status');
    if (!file) { if (nameEl) { nameEl.style.display = 'none'; nameEl.textContent = ''; } if (uploadBtn) uploadBtn.disabled = true; if (status) status.textContent = 'No file selected.'; return; }
    if (nameEl) { nameEl.style.display = 'block'; nameEl.textContent = file.name; }
    if (uploadBtn) uploadBtn.disabled = false;
    if (status) status.textContent = `${file.name} selected. Ready to upload.`;
}

const USER_STORAGE_KEYS = {
    uploaded: 'mmfsl-uploaded-users',
    overrides: 'mmfsl-user-overrides',
    deleted: 'mmfsl-deleted-user-ids',
    logs: 'mmfsl-user-upload-logs',
    lastResult: 'mmfsl-last-user-upload-result'
};

let currentUploadRows = [];
let currentUploadFile = null;
let currentUploadFileName = '';
let currentDeactivateFile = null;
let currentDeactivateFileName = '';

function normalizeDeactivateUploadHeader(header) {
    const normalized = String(header || '').trim().toLowerCase();
    const aliases = {
        'user id / sap id': 'User ID',
        'user id': 'User ID',
        'userid': 'User ID',
        'sap id': 'User ID'
    };
    return aliases[normalized] || header;
}

function createUserDeactivateTemplate() {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
        ['User ID / SAP ID'],
        ['DB-0001']
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Deactivate Users');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MMFSL_User_Deactivate_Template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function parseUserDeactivateRows(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });

                if (!rawRows.length) {
                    reject('The uploaded file does not contain any data.');
                    return;
                }

                const headers = rawRows[0].map((header) => normalizeDeactivateUploadHeader(header));
                const loginIdx = headers.indexOf('User Login ID');
                const userIdIdx = headers.indexOf('User ID');
                const idIdx = loginIdx !== -1 ? loginIdx : userIdIdx;

                if (idIdx === -1) {
                    reject('Please use the deactivate template and include the User ID / SAP ID column.');
                    return;
                }

                const rows = [];
                rawRows.slice(1).forEach((row, index) => {
                    const userId = String(row[idIdx] || '').trim();
                    if (!userId) return;
                    rows.push({ userId });
                });

                if (!rows.length) {
                    reject('No valid user IDs were found in the file.');
                    return;
                }

                resolve(rows);
            } catch (error) {
                reject('Unable to read the uploaded file. Please ensure it is a valid Excel or CSV file.');
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

function safeParse(key, fallback) {
    try {
        const rawValue = localStorage.getItem(key);
        return rawValue ? JSON.parse(rawValue) : fallback;
    } catch (error) {
        return fallback;
    }
}

function safeWrite(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        // Ignore storage failures for the admin UI.
    }
}

function getSeedUsers() {
    return Array.isArray(window.seedUsers) ? window.seedUsers.slice() : [];
}

function normalizeStoredUserRecord(user, fallbackIndex = 0) {
    if (!user || typeof user !== 'object') return null;

    const normalized = {
        dbId: user.dbId || `DB-${String(fallbackIndex + 1).padStart(4, '0')}`,
        userId: user.userId || user.loginId || '',
        userName: user.userName || '',
        userEmail: user.userEmail || user.emailId || '',
        source: user.source || 'Upload',
        uploadedAt: user.uploadedAt || new Date().toISOString()
    };

    if (!normalized.userId || !normalized.userName || !normalized.userEmail) {
        return null;
    }

    return normalized;
}

function normalizeStoredUploadedUsers() {
    const storedUsers = safeParse(USER_STORAGE_KEYS.uploaded, []);
    if (!Array.isArray(storedUsers)) {
        return [];
    }

    const normalizedUsers = storedUsers
        .map((user, index) => normalizeStoredUserRecord(user, index))
        .filter(Boolean);

    safeWrite(USER_STORAGE_KEYS.uploaded, normalizedUsers);
    return normalizedUsers;
}

function getUserOverrides() {
    const overrides = safeParse(USER_STORAGE_KEYS.overrides, {});
    return overrides && typeof overrides === 'object' ? overrides : {};
}

function getDeletedUserIds() {
    const deletedIds = safeParse(USER_STORAGE_KEYS.deleted, []);
    return Array.isArray(deletedIds) ? new Set(deletedIds) : new Set();
}

function getUploadLogs() {
    const logs = safeParse(USER_STORAGE_KEYS.logs, []);
    return Array.isArray(logs) ? logs : [];
}

function getLastUploadResult() {
    return safeParse(USER_STORAGE_KEYS.lastResult, null);
}

function persistUploadedUsers(users) {
    safeWrite(USER_STORAGE_KEYS.uploaded, users);
}

function getAllUsers() {
    const deletedIds = getDeletedUserIds();
    const overrides = getUserOverrides();
    const seedUsers = getSeedUsers().filter((user) => !deletedIds.has(user.dbId));
    const uploadedUsers = normalizeStoredUploadedUsers().filter((user) => !deletedIds.has(user.dbId));

    return [...seedUsers, ...uploadedUsers].map((user) => ({
        ...user,
        ...(overrides[user.dbId] || {})
    }));
}

function formatUserTimestamp(value) {
    if (!value) return 'N/A';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';

    return date.toLocaleString();
}

function renderUploadLogs() {
    const body = document.getElementById('user-upload-log-body');
    const note = document.getElementById('user-upload-log-note');

    if (!body) return;

    const logs = getUploadLogs();

    if (!logs.length) {
        body.innerHTML = '<tr><td colspan="6" style="padding:16px 14px; color:#6b7280;">No upload logs yet.</td></tr>';
        if (note) note.textContent = 'No upload result file has been generated yet.';
        return;
    }

    body.innerHTML = logs.map((log) => {
        const hasResultRows = Array.isArray(log.resultRows) && log.resultRows.length > 0;

        return `
            <tr>
                <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${log.fileName}</td>
                <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${log.action === 'deactivate' ? 'Deactivate' : 'Create'}</td>
                <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${formatUserTimestamp(log.uploadTimestamp)}</td>
                <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${log.totalRows}</td>
                <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${log.passedRows}</td>
                <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${log.failedRows}</td>
                <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">
                    <button type="button" class="action-btn" ${hasResultRows ? '' : 'disabled'} onclick="downloadUserUploadResult('${log.id}')" style="background:#e41837; color:white; border:none; padding:8px 12px; border-radius:8px; cursor:${hasResultRows ? 'pointer' : 'not-allowed'}; opacity:${hasResultRows ? 1 : 0.6};">
                        Download Result
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    if (note) {
        const latest = logs[0];
        note.textContent = `Latest result file: ${latest.resultFileName || 'Generated after upload'}`;
    }
}

function downloadUserUploadResult(logId) {
    const logs = getUploadLogs();
    const log = logId ? logs.find((entry) => entry.id === logId) : null;
    const resultRows = Array.isArray(log?.resultRows) && log.resultRows.length
        ? log.resultRows
        : Array.isArray(getLastUploadResult()?.rows) && getLastUploadResult().rows.length
            ? getLastUploadResult().rows
            : [];

    if (!resultRows.length) {
        showCustomModal({ title: 'Result File', message: 'No upload result file is available yet. Upload a file first to generate it.', type: 'info' });
        return;
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(resultRows.map((row) => ({
        'File Name': row.fileName,
        'Upload Timestamp': row.uploadTimestamp,
        'User Login ID': row.loginId,
        'User Name': row.userName,
        'User Email ID': row.emailId,
        'Status': row.status,
        'Message': row.message
    })));

    XLSX.utils.book_append_sheet(workbook, worksheet, 'User Upload Result');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = log?.resultFileName ? log.resultFileName : (getLastUploadResult()?.fileName ? `${getLastUploadResult().fileName.replace(/\.[^.]+$/, '')}.xlsx` : 'MMFSL_User_Upload_Result.xlsx');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function renderUserManagementList() {
    const body = document.getElementById('user-management-table-body');
    const summary = document.getElementById('user-management-summary');

    if (!body) return;

    const users = getAllUsers().sort((a, b) => a.userName.localeCompare(b.userName));

    if (!users.length) {
        body.innerHTML = '<tr><td colspan="5" style="padding:16px 14px; color:#6b7280;">No users found.</td></tr>';
        if (summary) summary.textContent = '0 users';
        return;
    }

    body.innerHTML = users.map((user) => `
        <tr>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.dbId}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.userId}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.userName}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.userEmail}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">
                <div style="display:flex; gap:8px; align-items:center; justify-content:flex-start;">
                    <button type="button" style="background:#f3f4f6; border:1px solid #e5e7eb; border-radius:8px; padding:8px; cursor:pointer; color:#111827;" onclick="handleViewUser('${user.dbId}')" title="View User">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button type="button" style="background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:8px; cursor:pointer; color:#9a3412;" onclick="handleUpdateUser('${user.dbId}')" title="Update User">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button type="button" style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:8px; cursor:pointer; color:#b91c1c;" onclick="handleDeleteUser('${user.dbId}')" title="Delete User">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    if (summary) summary.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
}

window.handleViewUser = function (dbId) {
    const user = getAllUsers().find((record) => record.dbId === dbId);

    if (!user) {
        showCustomModal({ title: 'User Details', message: 'This user could not be found.', type: 'info' });
        return;
    }

    const detailText = `DB ID: ${user.dbId}\nUser ID: ${user.userId}\nUser Name: ${user.userName}\nUser Email ID: ${user.userEmail}\nSource: ${user.source || 'Upload'}\nUploaded At: ${formatUserTimestamp(user.uploadedAt)}`;
    showCustomModal({ title: 'User Details', message: detailText, type: 'info' });
};

window.handleUpdateUser = function (dbId) {
    const user = getAllUsers().find((record) => record.dbId === dbId);

    if (!user) {
        showCustomModal({ title: 'Update User', message: 'This user could not be found.', type: 'info' });
        return;
    }

    const nextUserId = window.prompt('Update User ID', user.userId);
    const nextUserName = window.prompt('Update User Name', user.userName);
    const nextUserEmail = window.prompt('Update User Email ID', user.userEmail);

    if (!nextUserId || !nextUserName || !nextUserEmail) {
        return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(nextUserEmail)) {
        showCustomModal({ title: 'Update Error', message: 'Please enter a valid email address.', type: 'info' });
        return;
    }

    const duplicate = getAllUsers().some((record) => record.dbId !== dbId && record.userId.toLowerCase() === nextUserId.trim().toLowerCase());
    if (duplicate) {
        showCustomModal({ title: 'Update Error', message: 'Another user already uses this User Login ID.', type: 'info' });
        return;
    }

    const trimmedUserId = nextUserId.trim();
    const trimmedUserName = nextUserName.trim();
    const trimmedUserEmail = nextUserEmail.trim();

    if (user.source === 'Seed') {
        const overrides = getUserOverrides();
        overrides[dbId] = { ...user, userId: trimmedUserId, userName: trimmedUserName, userEmail: trimmedUserEmail };
        safeWrite(USER_STORAGE_KEYS.overrides, overrides);
    } else {
        const uploadedUsers = normalizeStoredUploadedUsers().map((record) => record.dbId === dbId
            ? { ...record, userId: trimmedUserId, userName: trimmedUserName, userEmail: trimmedUserEmail }
            : record
        );
        persistUploadedUsers(uploadedUsers);
    }

    renderUserManagementList();
    showCustomModal({ title: 'Update Successful', message: `${trimmedUserName} has been updated successfully.`, type: 'info' });
};

window.handleDeleteUser = async function (dbId) {
    const user = getAllUsers().find((record) => record.dbId === dbId);

    if (!user) {
        showCustomModal({ title: 'Delete User', message: 'This user could not be found.', type: 'info' });
        return;
    }

    const confirmed = await showCustomModal({
        title: 'Delete User',
        message: `Are you sure you want to delete ${user.userName}?`,
        type: 'confirm'
    });

    if (!confirmed) return;

    const deletedIds = getDeletedUserIds();
    deletedIds.add(dbId);
    safeWrite(USER_STORAGE_KEYS.deleted, Array.from(deletedIds));

    const uploadedUsers = normalizeStoredUploadedUsers().filter((record) => record.dbId !== dbId);
    persistUploadedUsers(uploadedUsers);

    renderUserManagementList();
    showCustomModal({ title: 'Delete Successful', message: `${user.userName} has been deleted.`, type: 'info' });
};

function resetUserUploadPage() {
    const fileInput = document.getElementById('user-upload-file-input');
    const fileName = document.getElementById('user-upload-file-name');
    const uploadBtn = document.getElementById('upload-user-submit-btn');
    const deactivateBtn = document.getElementById('upload-deactivate-submit-btn');
    const status = document.getElementById('user-upload-status');
    const dropZone = document.getElementById('user-upload-drop-zone');
    const deactivateFileInput = document.getElementById('deactivate-upload-file-input');
    const deactivateFileName = document.getElementById('deactivate-upload-file-name');
    const deactivateStatus = document.getElementById('deactivate-upload-status');
    const deactivateDropZone = document.getElementById('deactivate-upload-drop-zone');
    const downloadResultBtn = document.getElementById('download-user-result-btn');

    currentUploadRows = [];
    currentUploadFile = null;
    currentUploadFileName = '';
    currentDeactivateFile = null;
    currentDeactivateFileName = '';

    if (fileInput) fileInput.value = '';
    if (fileName) {
        fileName.textContent = '';
        fileName.style.display = 'none';
    }
    if (uploadBtn) uploadBtn.disabled = true;
    if (status) status.textContent = 'Select a file to begin.';
    if (dropZone) dropZone.style.borderColor = '#e5e7eb';

    if (deactivateFileInput) deactivateFileInput.value = '';
    if (deactivateFileName) {
        deactivateFileName.textContent = '';
        deactivateFileName.style.display = 'none';
    }
    if (deactivateBtn) deactivateBtn.disabled = true;
    if (deactivateStatus) deactivateStatus.textContent = 'Select a file to begin.';
    if (deactivateDropZone) deactivateDropZone.style.borderColor = '#e5e7eb';

    if (downloadResultBtn) downloadResultBtn.disabled = !getLastUploadResult();
    renderUserUploadPreview([]);
    renderUserManagementList();
    renderUploadLogs();
}

function parseUserUploadRows(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });

                if (!rawRows.length) {
                    reject('The uploaded file does not contain any data.');
                    return;
                }

                const headers = rawRows[0].map((header) => normalizeUserUploadHeader(header));
                const loginIdx = headers.indexOf('User Login ID');
                const nameIdx = headers.indexOf('User Name');
                const emailIdx = headers.indexOf('User Email ID');

                if (loginIdx === -1 || nameIdx === -1 || emailIdx === -1) {
                    reject('Please use the downloaded template and keep the required column names: User Login ID, User Name, and User Email ID.');
                    return;
                }

                const rows = [];
                rawRows.slice(1).forEach((row, index) => {
                    const loginId = String(row[loginIdx] || '').trim();
                    const userName = String(row[nameIdx] || '').trim();
                    const emailId = String(row[emailIdx] || '').trim();

                    if (!loginId && !userName && !emailId) return;
                    if (!loginId || !userName || !emailId) {
                        reject(`Row ${index + 2} is incomplete. Please provide values for User Login ID, User Name and User Email ID.`);
                        return;
                    }

                    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailPattern.test(emailId)) {
                        reject(`Row ${index + 2} has an invalid email address: ${emailId}`);
                        return;
                    }

                    rows.push({ loginId, userName, emailId });
                });

                if (!rows.length) {
                    reject('No valid user rows were found in the file.');
                    return;
                }

                resolve(rows);
            } catch (error) {
                reject('Unable to read the uploaded file. Please ensure it is a valid Excel or CSV file.');
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

function initUserUploadPage() {
    const fileInput = document.getElementById('user-upload-file-input');
    const dropZone = document.getElementById('user-upload-drop-zone');
    const fileName = document.getElementById('user-upload-file-name');
    const uploadBtn = document.getElementById('upload-user-submit-btn');
    const deactivateBtn = document.getElementById('upload-deactivate-submit-btn');
    const downloadBtn = document.getElementById('download-user-template-btn');
    const deactivateTemplateBtn = document.getElementById('download-deactivate-template-btn');
    const downloadResultBtn = document.getElementById('download-user-result-btn');
    const deactivateFileInput = document.getElementById('deactivate-upload-file-input');
    const deactivateDropZone = document.getElementById('deactivate-upload-drop-zone');
    const deactivateFileName = document.getElementById('deactivate-upload-file-name');
    const deactivateStatus = document.getElementById('deactivate-upload-status');

    if (!fileInput || !dropZone) return;

    resetUserUploadPage();

    if (downloadBtn) {
        downloadBtn.onclick = () => createUserUploadTemplate();
    }

    if (deactivateTemplateBtn) {
        deactivateTemplateBtn.onclick = () => createUserDeactivateTemplate();
    }

    if (downloadResultBtn) {
        downloadResultBtn.onclick = () => downloadUserUploadResult();
    }

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        currentUploadFile = file;
        currentUploadFileName = file.name;

        if (fileName) {
            fileName.textContent = `Selected: ${file.name}`;
            fileName.style.display = 'block';
        }

        try {
            const rows = await parseUserUploadRows(file);
            currentUploadRows = rows;
            renderUserUploadPreview(rows);
            if (uploadBtn) uploadBtn.disabled = false;
        } catch (errorMessage) {
            currentUploadRows = [];
            currentUploadFile = null;
            if (uploadBtn) uploadBtn.disabled = true;
            showCustomModal({ title: 'Upload Error', message: errorMessage, type: 'info' });
        }
    };

    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#e41837';
        dropZone.style.background = '#fff5f6';
    };

    dropZone.ondragleave = () => {
        dropZone.style.borderColor = '#e5e7eb';
        dropZone.style.background = '#f9fafb';
    };

    dropZone.ondrop = async (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#e5e7eb';
        dropZone.style.background = '#f9fafb';
        const file = e.dataTransfer.files[0];
        if (!file) return;

        currentUploadFile = file;
        currentUploadFileName = file.name;

        if (fileName) {
            fileName.textContent = `Selected: ${file.name}`;
            fileName.style.display = 'block';
        }

        try {
            const rows = await parseUserUploadRows(file);
            currentUploadRows = rows;
            renderUserUploadPreview(rows);
            if (uploadBtn) uploadBtn.disabled = false;
        } catch (errorMessage) {
            currentUploadRows = [];
            currentUploadFile = null;
            if (uploadBtn) uploadBtn.disabled = true;
            showCustomModal({ title: 'Upload Error', message: errorMessage, type: 'info' });
        }
    };

    if (deactivateFileInput) {
        deactivateFileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            currentDeactivateFile = file;
            currentDeactivateFileName = file.name;

            if (deactivateFileName) {
                deactivateFileName.textContent = `Selected: ${file.name}`;
                deactivateFileName.style.display = 'block';
            }
            if (deactivateStatus) deactivateStatus.textContent = `${file.name} ready to upload.`;

            try {
                await parseUserDeactivateRows(file);
                if (deactivateBtn) deactivateBtn.disabled = false;
            } catch (errorMessage) {
                currentDeactivateFile = null;
                if (deactivateBtn) deactivateBtn.disabled = true;
                showCustomModal({ title: 'Deactivate Error', message: errorMessage, type: 'info' });
            }
        };
    }

    if (deactivateDropZone) {
        deactivateDropZone.ondragover = (e) => {
            e.preventDefault();
            deactivateDropZone.style.borderColor = '#e41837';
            deactivateDropZone.style.background = '#fff5f6';
        };

        deactivateDropZone.ondragleave = () => {
            deactivateDropZone.style.borderColor = '#e5e7eb';
            deactivateDropZone.style.background = '#f9fafb';
        };

        deactivateDropZone.ondrop = async (e) => {
            e.preventDefault();
            deactivateDropZone.style.borderColor = '#e5e7eb';
            deactivateDropZone.style.background = '#f9fafb';
            const file = e.dataTransfer.files[0];
            if (!file) return;

            currentDeactivateFile = file;
            currentDeactivateFileName = file.name;

            if (deactivateFileName) {
                deactivateFileName.textContent = `Selected: ${file.name}`;
                deactivateFileName.style.display = 'block';
            }
            if (deactivateStatus) deactivateStatus.textContent = `${file.name} ready to upload.`;

            try {
                await parseUserDeactivateRows(file);
                if (deactivateBtn) deactivateBtn.disabled = false;
            } catch (errorMessage) {
                currentDeactivateFile = null;
                if (deactivateBtn) deactivateBtn.disabled = true;
                showCustomModal({ title: 'Deactivate Error', message: errorMessage, type: 'info' });
            }
        };
    }

    if (uploadBtn) {
        uploadBtn.onclick = async () => {
            if (!currentUploadRows.length) {
                showCustomModal({ title: 'Upload Error', message: 'Please select a valid file with user data before uploading.', type: 'info' });
                return;
            }

            const uploadedAt = new Date().toISOString();
            const resultRows = [];
            const newUsers = [];
            const uploadedUsers = normalizeStoredUploadedUsers();
            const existingUserIds = new Set(getAllUsers().map((user) => user.userId.toLowerCase()));
            const seenInFile = new Set();

            currentUploadRows.forEach((row) => {
                const normalizedUserId = row.loginId.trim().toLowerCase();
                const duplicate = existingUserIds.has(normalizedUserId) || seenInFile.has(normalizedUserId);
                seenInFile.add(normalizedUserId);

                if (duplicate) {
                    resultRows.push({
                        fileName: currentUploadFileName,
                        uploadTimestamp: uploadedAt,
                        loginId: row.loginId,
                        userName: row.userName,
                        emailId: row.emailId,
                        status: 'Failed',
                        message: 'User Login ID already exists.'
                    });
                    return;
                }

                existingUserIds.add(normalizedUserId);
                newUsers.push({
                    dbId: `DB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
                    userId: row.loginId,
                    userName: row.userName,
                    userEmail: row.emailId,
                    source: 'Upload',
                    uploadedAt
                });
                resultRows.push({
                    fileName: currentUploadFileName,
                    uploadTimestamp: uploadedAt,
                    loginId: row.loginId,
                    userName: row.userName,
                    emailId: row.emailId,
                    status: 'Passed',
                    message: 'User added successfully.'
                });
            });

            persistUploadedUsers([...uploadedUsers, ...newUsers]);

            const logEntry = {
                id: `log-${Date.now()}`,
                fileName: currentUploadFileName,
                uploadTimestamp: uploadedAt,
                totalRows: currentUploadRows.length,
                passedRows: resultRows.filter((row) => row.status === 'Passed').length,
                failedRows: resultRows.filter((row) => row.status === 'Failed').length,
                resultRows,
                resultFileName: `MMFSL_User_Upload_Result_${new Date(uploadedAt).toISOString().replace(/[:.]/g, '-')}.xlsx`
            };

            const logs = getUploadLogs();
            logs.unshift(logEntry);
            safeWrite(USER_STORAGE_KEYS.logs, logs.slice(0, 10));
            safeWrite(USER_STORAGE_KEYS.lastResult, {
                fileName: currentUploadFileName,
                uploadTimestamp: uploadedAt,
                rows: resultRows,
                logId: logEntry.id
            });

            currentUploadRows = [];
            currentUploadFileName = '';

            renderUserUploadPreview([]);
            renderUserManagementList();
            renderUploadLogs();
            if (status) status.textContent = `${resultRows.length} user${resultRows.length === 1 ? '' : 's'} processed. ${logEntry.passedRows} passed, ${logEntry.failedRows} failed.`;
            if (uploadBtn) uploadBtn.disabled = true;
            if (fileName) {
                fileName.textContent = '';
                fileName.style.display = 'none';
            }
            if (downloadResultBtn) downloadResultBtn.disabled = false;

            showCustomModal({
                title: 'Upload Complete',
                message: `${resultRows.length} user${resultRows.length === 1 ? '' : 's'} processed. ${logEntry.passedRows} passed, ${logEntry.failedRows} failed.`,
                type: 'info'
            });
        };
    }

    if (deactivateBtn) {
        deactivateBtn.onclick = async () => {
            if (!currentDeactivateFile) {
                showCustomModal({ title: 'Deactivate Error', message: 'Please select a valid deactivate file before uploading.', type: 'info' });
                return;
            }

            try {
                const rows = await parseUserDeactivateRows(currentDeactivateFile);
                const uploadedAt = new Date().toISOString();
                const resultRows = [];
                const deletedIds = getDeletedUserIds();
                const allUsers = getAllUsers();
                const userMap = new Map(allUsers.map((user) => [String(user.userId).trim().toLowerCase(), user]));
                const seenInFile = new Set();

                rows.forEach((row) => {
                    const normalizedUserId = String(row.userId || '').trim().toLowerCase();
                    if (!normalizedUserId) return;
                    if (seenInFile.has(normalizedUserId)) {
                        resultRows.push({
                            fileName: currentDeactivateFileName,
                            uploadTimestamp: uploadedAt,
                            loginId: row.userId,
                            userName: '',
                            emailId: '',
                            status: 'Failed',
                            message: 'Duplicate User ID in file.'
                        });
                        return;
                    }
                    seenInFile.add(normalizedUserId);

                    const user = userMap.get(normalizedUserId);
                    if (!user) {
                        resultRows.push({
                            fileName: currentDeactivateFileName,
                            uploadTimestamp: uploadedAt,
                            loginId: row.userId,
                            userName: '',
                            emailId: '',
                            status: 'Failed',
                            message: 'User ID not found.'
                        });
                        return;
                    }

                    if (deletedIds.has(user.dbId)) {
                        resultRows.push({
                            fileName: currentDeactivateFileName,
                            uploadTimestamp: uploadedAt,
                            loginId: user.userId,
                            userName: user.userName,
                            emailId: user.userEmail,
                            status: 'Failed',
                            message: 'User is already deactivated.'
                        });
                        return;
                    }

                    deletedIds.add(user.dbId);
                    resultRows.push({
                        fileName: currentDeactivateFileName,
                        uploadTimestamp: uploadedAt,
                        loginId: user.userId,
                        userName: user.userName,
                        emailId: user.userEmail,
                        status: 'Passed',
                        message: 'User deactivated successfully.'
                    });
                });

                safeWrite(USER_STORAGE_KEYS.deleted, Array.from(deletedIds));

                const logEntry = {
                    id: `log-${Date.now()}`,
                    fileName: currentDeactivateFileName,
                    uploadTimestamp: uploadedAt,
                    totalRows: rows.length,
                    passedRows: resultRows.filter((row) => row.status === 'Passed').length,
                    failedRows: resultRows.filter((row) => row.status === 'Failed').length,
                    resultRows,
                    resultFileName: `MMFSL_User_Deactivate_Result_${new Date(uploadedAt).toISOString().replace(/[:.]/g, '-')}.xlsx`,
                    action: 'deactivate'
                };

                const logs = getUploadLogs();
                logs.unshift(logEntry);
                safeWrite(USER_STORAGE_KEYS.logs, logs.slice(0, 10));
                safeWrite(USER_STORAGE_KEYS.lastResult, {
                    fileName: currentDeactivateFileName,
                    uploadTimestamp: uploadedAt,
                    rows: resultRows,
                    logId: logEntry.id,
                    action: 'deactivate'
                });

                currentDeactivateFile = null;
                currentDeactivateFileName = '';

                renderUserUploadPreview([]);
                renderUserManagementList();
                renderUploadLogs();
                if (deactivateStatus) deactivateStatus.textContent = `${resultRows.length} record${resultRows.length === 1 ? '' : 's'} processed. ${logEntry.passedRows} deactivated, ${logEntry.failedRows} failed.`;
                if (deactivateBtn) deactivateBtn.disabled = true;
                if (deactivateFileName) {
                    deactivateFileName.textContent = '';
                    deactivateFileName.style.display = 'none';
                }
                if (downloadResultBtn) downloadResultBtn.disabled = false;

                showCustomModal({
                    title: 'Deactivate Complete',
                    message: `${resultRows.length} record${resultRows.length === 1 ? '' : 's'} processed. ${logEntry.passedRows} deactivated, ${logEntry.failedRows} failed.`,
                    type: 'info'
                });
            } catch (errorMessage) {
                showCustomModal({ title: 'Deactivate Error', message: errorMessage, type: 'info' });
            }
        };
    }

    renderUserManagementList();
    renderUploadLogs();
}

window.handleViewUser = function (dbId) {
    const user = getAllUsers().find((record) => record.dbId === dbId);

    if (!user) {
        showCustomModal({ title: 'User Details', message: 'This user could not be found.', type: 'info' });
        return;
    }

    const detailText = `DB ID: ${user.dbId}\nUser ID: ${user.userId}\nUser Name: ${user.userName}\nUser Email ID: ${user.userEmail}\nSource: ${user.source || 'Upload'}\nUploaded At: ${formatUserTimestamp(user.uploadedAt)}`;
    showCustomModal({ title: 'User Details', message: detailText, type: 'info' });
};

window.handleUpdateUser = function (dbId) {
    const user = getAllUsers().find((record) => record.dbId === dbId);

    if (!user) {
        showCustomModal({ title: 'Update User', message: 'This user could not be found.', type: 'info' });
        return;
    }

    const nextUserId = window.prompt('Update User ID', user.userId);
    const nextUserName = window.prompt('Update User Name', user.userName);
    const nextUserEmail = window.prompt('Update User Email ID', user.userEmail);

    if (!nextUserId || !nextUserName || !nextUserEmail) {
        return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(nextUserEmail)) {
        showCustomModal({ title: 'Update Error', message: 'Please enter a valid email address.', type: 'info' });
        return;
    }

    const duplicate = getAllUsers().some((record) => record.dbId !== dbId && record.userId.toLowerCase() === nextUserId.trim().toLowerCase());
    if (duplicate) {
        showCustomModal({ title: 'Update Error', message: 'Another user already uses this User Login ID.', type: 'info' });
        return;
    }

    const trimmedUserId = nextUserId.trim();
    const trimmedUserName = nextUserName.trim();
    const trimmedUserEmail = nextUserEmail.trim();

    if (user.source === 'Seed') {
        const overrides = getUserOverrides();
        overrides[dbId] = { ...user, userId: trimmedUserId, userName: trimmedUserName, userEmail: trimmedUserEmail };
        safeWrite(USER_STORAGE_KEYS.overrides, overrides);
    } else {
        const uploadedUsers = normalizeStoredUploadedUsers().map((record) => record.dbId === dbId
            ? { ...record, userId: trimmedUserId, userName: trimmedUserName, userEmail: trimmedUserEmail }
            : record
        );
        persistUploadedUsers(uploadedUsers);
    }

    renderUserManagementList();
    showCustomModal({ title: 'Update Successful', message: `${trimmedUserName} has been updated successfully.`, type: 'info' });
};

window.handleDeleteUser = async function (dbId) {
    const user = getAllUsers().find((record) => record.dbId === dbId);

    if (!user) {
        showCustomModal({ title: 'Delete User', message: 'This user could not be found.', type: 'info' });
        return;
    }

    const confirmed = await showCustomModal({
        title: 'Delete User',
        message: `Are you sure you want to delete ${user.userName}?`,
        type: 'confirm'
    });

    if (!confirmed) return;

    const deletedIds = getDeletedUserIds();
    deletedIds.add(dbId);
    safeWrite(USER_STORAGE_KEYS.deleted, Array.from(deletedIds));

    const uploadedUsers = normalizeStoredUploadedUsers().filter((record) => record.dbId !== dbId);
    persistUploadedUsers(uploadedUsers);

    renderUserManagementList();
    showCustomModal({ title: 'Delete Successful', message: `${user.userName} has been deleted.`, type: 'info' });
};

function renderUserManagementList() {
    const body = document.getElementById('user-management-table-body');
    const summary = document.getElementById('user-management-summary');

    if (!body) return;

    const users = getAllUsers().sort((a, b) => a.userName.localeCompare(b.userName));

    if (!users.length) {
        body.innerHTML = '<tr><td colspan="5" style="padding:16px 14px; color:#6b7280;">No users found.</td></tr>';
        if (summary) summary.textContent = '0 users';
        return;
    }

    body.innerHTML = users.map((user) => `
        <tr>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.dbId}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.userId}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.userName}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">${user.userEmail}</td>
            <td style="padding:12px 14px; border-bottom:1px solid #e5e7eb;">
                <div style="display:flex; gap:8px; align-items:center; justify-content:flex-start;">
                    <button type="button" style="background:#f3f4f6; border:1px solid #e5e7eb; border-radius:8px; padding:8px; cursor:pointer; color:#111827;" onclick="handleViewUser('${user.dbId}')" title="View User">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button type="button" style="background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:8px; cursor:pointer; color:#9a3412;" onclick="handleUpdateUser('${user.dbId}')" title="Update User">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button type="button" style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:8px; cursor:pointer; color:#b91c1c;" onclick="handleDeleteUser('${user.dbId}')" title="Delete User">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    if (summary) summary.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
}

// =========================================================
// INLINE ENTITY SELECTOR (HEADER)
// =========================================================
// Populates the custom mini-selector in the Mapping Board header
window.populateHeaderEntitySelect = function () {
    const trigger = document.getElementById('header-select-trigger');
    const optionsContainer = document.getElementById('header-select-options');
    const valueEl = document.getElementById('header-select-value');
    const wrapper = document.getElementById('header-custom-select');

    if (!trigger || !optionsContainer) return;

    // Toggle dropdown
    trigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.toggle('open');
        if (isOpen) {
            // Close other dropdowns if any
        }
    };

    // Close on outside click
    document.addEventListener('click', () => {
        wrapper.classList.remove('open');
    });

    optionsContainer.innerHTML = '';
    (createdEntityTypes || []).forEach(et => {
        const val = et.name.toLowerCase().replace(/\s+/g, '_');
        const opt = document.createElement('div');
        opt.className = 'header-opt';
        opt.textContent = et.name;
        if (selectedEntityType === val) {
            opt.classList.add('active');
            if (valueEl) valueEl.textContent = et.name;
        }

        opt.onclick = (e) => {
            e.stopPropagation();
            selectedEntityType = val;
            if (valueEl) valueEl.textContent = et.name;
            wrapper.classList.remove('open');

            // Re-render opt states
            optionsContainer.querySelectorAll('.header-opt').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');

            syncMappingColumnsToEntityType();
            renderLists();
        };

        optionsContainer.appendChild(opt);
    });

    if (!selectedEntityType && createdEntityTypes.length > 0) {
        const first = createdEntityTypes[0];
        selectedEntityType = first.name.toLowerCase().replace(/\s+/g, '_');
        if (valueEl) valueEl.textContent = first.name;
    }
};


// =========================================================
// ENTITY USER MAPPING overlay helpers
// =========================================================


// =========================================================
// CREATE ENTITY TYPE FORM
// =========================================================
const GEOGRAPHY_OPTIONS = ['Zone', 'Region', 'State', 'Circle', 'Cluster', 'Branch', 'Area', 'Hub'];
let createdEntityTypes = [
    {
        name: 'Retail Branch',
        geoLevels: ['Region', 'State', 'Circle', 'Cluster', 'Branch'],
        attributes: [
            { name: 'Branch Code', type: 'Alpha Numeric (250 Characters)', isFixed: true },
            { name: 'Branch Name', type: 'Alpha Numeric (250 Characters)', isFixed: true },
            { name: 'Region', type: 'Alpha Numeric (250 Characters)', isFixed: true },
            { name: 'State', type: 'Alpha Numeric (250 Characters)', isFixed: true },
            { name: 'Circle', type: 'Alpha Numeric (250 Characters)', isFixed: true },
            { name: 'Cluster', type: 'Alpha Numeric (250 Characters)', isFixed: true },
            { name: 'Entity Category', type: 'Alpha Numeric (250 Characters)', isFixed: true }
        ],
        createdOn: '28/04/2026'
    },
];



function initCreateEntityForm() {
    const GEOGRAPHY_OPTIONS = ['Zone', 'Region', 'State', 'Circle', 'Cluster', 'Branch', 'Area', 'Hub'];
    const nameEl = document.getElementById('entity-type-name');
    const geoCountEl = document.getElementById('geo-level-count');
    const geoContainer = document.getElementById('geo-levels-container');
    const attrList = document.getElementById('attributes-list');

    if (!nameEl) return;

    // --- Stepper Control for Hierarchy Level Count ---
    const minusBtn = document.getElementById('geo-level-minus');
    const plusBtn = document.getElementById('geo-level-plus');
    const displayEl = document.getElementById('geo-level-display');
    const countInput = document.getElementById('geo-level-count');

    const updateCount = (newCount) => {
        if (newCount < 2) newCount = 2;
        if (newCount > 6) newCount = 6;
        if (countInput) countInput.value = newCount;
        if (displayEl) displayEl.textContent = newCount;
        if (countInput) countInput.dispatchEvent(new Event('change'));
    };

    if (minusBtn) minusBtn.onclick = () => updateCount(parseInt(countInput.value) - 1);
    if (plusBtn) plusBtn.onclick = () => updateCount(parseInt(countInput.value) + 1);

    // Initial default
    if (countInput) {
        countInput.value = "4";
        if (displayEl) displayEl.textContent = "4";
    }

    if (geoCountEl) {
        geoCountEl.addEventListener('change', function () {
            const count = parseInt(this.value) || 0;
            if (geoContainer) geoContainer.innerHTML = '';

            const previewContainer = document.getElementById('live-hierarchy-preview');
            if (previewContainer) previewContainer.innerHTML = '';

            if (count === 0) return;

            // 1. Render Inputs on the Left (Simplified list)
            for (let i = 1; i <= count; i++) {
                const row = document.createElement('div');
                const isLast = (i === count);
                row.style.marginBottom = '16px';

                row.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="font-size:12px; font-weight:700; color:#4b5563;">Level ${i} Name (e.g. Branch)</label>
                        ${isLast ? '<span style="font-size:10px; color:#e41837; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Mandatory Base</span>' : ''}
                    </div>
                    <select class="cet-input cet-select geo-level-select" data-level="${i}" 
                        style="width:100%; ${isLast ? 'background:#f8f9fa; border-color:#e5e7eb; color:#9ca3af; font-weight:600;' : ''}"
                        ${isLast ? 'disabled' : ''}>
                        <option value="">— Select Hierarchy Name —</option>
                        ${GEOGRAPHY_OPTIONS.map(o => `<option value="${o}" ${isLast && o === 'Branch' ? 'selected' : ''}>${o}</option>`).join('')}
                    </select>
                `;
                if (geoContainer) geoContainer.appendChild(row);
            }

            // 2. Setup Preview Linkers
            const selects = geoContainer.querySelectorAll('.geo-level-select');

            function updateLivePreview() {
                if (!previewContainer) return;
                previewContainer.innerHTML = '';

                const values = Array.from(selects).map(s => s.value || `Level ${s.dataset.level}`);

                // Redraw high-fidelity hierarchy preview
                renderSummaryTo(values, previewContainer, document.createElement('div'));

                // Refresh mapping table if area is visible
                const mappingArea = document.getElementById('mapping-selection-area');
                if (mappingArea && mappingArea.style.display !== 'none' && excelHeaders.length > 0) {
                    const tbody = document.getElementById('excel-mapping-tbody');
                    if (tbody) {
                        const currentMappings = {};
                        tbody.querySelectorAll('select').forEach(sel => {
                            if (sel.value) currentMappings[sel.dataset.field] = sel.value;
                        });

                        tbody.innerHTML = '';
                        values.forEach(lvl => {
                            const row = document.createElement('tr');
                            row.style.borderBottom = '1px solid #eee';
                            row.innerHTML = `
                                <td style="padding: 12px 16px; font-weight: 600; color: #374151;">${lvl}</td>
                                <td style="padding: 12px 16px;">
                                    <select class="cet-input mapping-select" data-field="${lvl}" style="width: 100%; font-size: 13px;">
                                        <option value="">-- Select Excel Header --</option>
                                        ${excelHeaders.map(h => `<option value="${h}" ${currentMappings[lvl] === h ? 'selected' : ''}>${h}</option>`).join('')}
                                    </select>
                                </td>
                            `;
                            tbody.appendChild(row);
                        });
                    }
                }
            }

            selects.forEach(sel => {
                sel.onchange = () => {
                    // Unique check
                    const chosen = Array.from(selects).map(s => s.value).filter(Boolean);
                    selects.forEach(s => {
                        Array.from(s.options).forEach(opt => {
                            if (opt.value && opt.value !== s.value) {
                                opt.disabled = chosen.includes(opt.value);
                            }
                        });
                    });
                    updateLivePreview();
                };
            });

            updateLivePreview();
            if (selects.length > 0) {
                selects[0].onchange();
            }
        });

        // Initial trigger
        geoCountEl.dispatchEvent(new Event('change'));
    }

    function renderAttributes(geoLevels) {
        const container = document.getElementById('attributes-tables-container');
        const miniFunnel = document.getElementById('attr-mini-funnel');
        if (!container || !miniFunnel) return;

        container.innerHTML = '';
        miniFunnel.innerHTML = '';

        // 1. Mini Funnel Nodes
        geoLevels.forEach((level, idx) => {
            const i = idx + 1;
            const node = document.createElement('div');
            node.className = `mini-funnel-node lvl-${i} ${i === geoLevels.length ? 'active' : ''}`;
            node.innerHTML = `
                <div class="p-card-icon" style="width:20px; height:20px;">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                </div>
                <span>${level}</span>
            `;
            miniFunnel.appendChild(node);
        });

        // 2. Row-based Attribute List (Matched to image)
        const branchLevel = geoLevels[geoLevels.length - 1];
        const group = document.createElement('div');
        group.style.padding = '10px 20px';

        const defaultAttrs = [
            { name: 'Branch Code', type: 'INTEGER NUMBER' },
            { name: 'Branch Name', type: 'ALPHA NUMERIC(250 Characters)' }
        ];
        const hierarchyAttrs = geoLevels.slice(0, -1).map(l => ({ name: l, type: 'ALPHA NUMERIC(250 Characters)' }));
        const finalAttrs = [...defaultAttrs, ...hierarchyAttrs, { name: 'Branch Type', type: 'ALPHA NUMERIC(250 Characters)' }];

        group.innerHTML = `
            <div id="attr-rows-wrapper" style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                ${finalAttrs.map(attr => `
                    <div class="attr-input-group" style="display:flex; flex-direction:column; gap:8px;">
                        <label style="font-size:12px; color:#6b7280; font-weight:500;">Attribute Name</label>
                        <input type="text" class="cet-input" value="${attr.name}" readonly style="background:#f9fafb; font-size:14px; border-color:#eee; color:#374151;">
                    </div>
                    <div class="attr-input-group" style="display:flex; flex-direction:column; gap:8px;">
                        <label style="font-size:12px; color:#6b7280; font-weight:500;">Attribute Type</label>
                        <input type="text" class="cet-input" value="${attr.type}" readonly style="background:#f9fafb; font-size:14px; border-color:#eee; color:#374151;">
                    </div>
                `).join('')}
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:24px;">
                <button class="action-btn" id="btn-add-custom-field" style="width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; padding:0; background:#f3f4f6; border:1px solid #e5e7eb;">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#4b5563" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
                </button>
            </div>
        `;
        container.appendChild(group);

        const addBtn = document.getElementById('btn-add-custom-field');
        if (addBtn) {
            addBtn.onclick = () => {
                const wrapper = document.getElementById('attr-rows-wrapper');
                const nameGrp = document.createElement('div');
                nameGrp.className = 'attr-input-group';
                nameGrp.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
                nameGrp.innerHTML = `
                    <label style="font-size:12px; color:#6b7280; font-weight:500;">Attribute Name</label>
                    <input type="text" class="cet-input" placeholder="Field Name" style="font-size:14px; border-color:#e4183766;">
                `;
                const typeGrp = document.createElement('div');
                typeGrp.className = 'attr-input-group';
                typeGrp.style.cssText = 'display:flex; flex-direction:column; gap:8px; position:relative;';
                typeGrp.innerHTML = `
                    <label style="font-size:12px; color:#6b7280; font-weight:500;">Attribute Type</label>
                    <select class="cet-input cet-select" style="font-size:14px;">
                        <option>ALPHA NUMERIC(250 Characters)</option>
                        <option>INTEGER NUMBER</option>
                        <option>DATE</option>
                    </select>
                    <button style="position:absolute; right:-24px; top:36px; background:none; border:none; color:#e41837; cursor:pointer;" onclick="this.parentElement.previousElementSibling.remove(); this.parentElement.remove();">
                         <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                    </button>
                `;
                wrapper.appendChild(nameGrp);
                wrapper.appendChild(typeGrp);
            };
        }
    }



    // Initial render
    renderEntityTypes();

    // Create button

    const createBtn = document.getElementById('btn-create-entity');
    if (createBtn) {
        createBtn.addEventListener('click', function () {
            const typeName = nameEl.value.trim();
            if (!typeName) { alert('Please enter an Entity Type name.'); return; }

            const selects = geoContainer ? geoContainer.querySelectorAll('.geo-level-select') : [];
            const geoLevels = Array.from(selects).map(function (s) { return s.value; }).filter(Boolean);
            const count = parseInt(geoCountEl.value) || 0;
            if (geoLevels.length !== count || count === 0) { alert('Please complete all geography level selections.'); return; }
            // Scrape attributes from Step 2 Dynamic Table
            const attrRows = document.querySelectorAll('#dynamic-attr-tbody tr');
            const attrs = Array.from(attrRows).map(row => {
                const nameInput = row.querySelector('.branch-attr-name');
                const typeSelect = row.querySelector('.branch-attr-type');
                return {
                    name: nameInput ? nameInput.value.trim() : 'Unknown',
                    type: typeSelect ? typeSelect.value : 'Alpha Numeric (250 Characters)'
                };
            }).filter(a => a.name);

            const today = new Date();
            const dd = String(today.getDate()).padStart(2, '0');
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();

            const dynamicContext = processExcelData(geoLevels);

            createdEntityTypes.push({
                name: typeName,
                geoLevels: geoLevels,
                attributes: attrs,
                createdOn: dd + '/' + mm + '/' + yyyy,
                dynamicData: dynamicContext.data,
                dynamicMappings: dynamicContext.mappings
            });

            resetCetForm();
            if (window.populateHeaderEntitySelect) window.populateHeaderEntitySelect();

            document.getElementById('success-modal-msg').textContent =
                '"' + typeName + '" entity type has been saved successfully.';
            document.getElementById('success-modal').style.display = 'flex';
        });
    }

    // Success modal OK
    const modalOk = document.getElementById('success-modal-ok');
    if (modalOk) {
        modalOk.addEventListener('click', function () {
            document.getElementById('success-modal').style.display = 'none';
            showPage('list-entity-page');
            renderEntityTypes();
        });
    }
    // --- STEPPER TAB CLICKS ---
    document.querySelectorAll('.cet-tab').forEach(tab => {
        tab.onclick = () => {
            const tIdx = parseInt(tab.dataset.tab);
            const isPastOrActive = (tab.style.opacity === '1');
            if (isPastOrActive) {
                window.moveCetToTab(tIdx);
            }
        };
    });

    // --- STEP 1 NEXT ---
    const btnNext1 = document.getElementById('btn-next-tab-1');
    if (btnNext1) {
        btnNext1.onclick = () => {
            const typeName = nameEl.value.trim();
            if (!typeName) {
                showCustomModal({ title: 'Input Required', message: 'Please provide an Entity Type Name.', type: 'info' });
                return;
            }
            const selects = geoContainer.querySelectorAll('.geo-level-select');
            const filled = Array.from(selects).map(s => s.value).filter(Boolean);
            if (filled.length === 0) {
                showCustomModal({ title: 'Selection Required', message: 'Please define at least one hierarchy level.', type: 'info' });
                return;
            }

            // Render attributes for Step 2
            if (window.renderAttributes) window.renderAttributes(filled);
            moveCetToTab(2);
        };
    }

    // --- STEP 2 NEXT ---
    const btnNext2 = document.getElementById('btn-next-tab-2');
    if (btnNext2) {
        btnNext2.onclick = () => {
            const selects = geoContainer.querySelectorAll('.geo-level-select');
            const filled = Array.from(selects).map(s => s.value).filter(Boolean);
            if (window.renderSummary) window.renderSummary(filled);

            // Prepare Step 3: Excel Upload
            initExcelUpload(filled);
            moveCetToTab(3);
        };
    }

    // --- STEP 3 NEXT ---
    const btnNext3 = document.getElementById('btn-next-tab-3');
    if (btnNext3) {
        btnNext3.onclick = () => {
            moveCetToTab(4);
        };
    }

    // --- STEP 3 SKIP ---
    const btnSkipExcel = document.getElementById('btn-skip-excel');
    if (btnSkipExcel) {
        btnSkipExcel.onclick = () => {
            // Reset excel state if skipped
            excelData = null;
            excelHeaders = [];
            excelMappings = {};
            moveCetToTab(4);
        };
    }
}

// =========================================================
// EXCEL UPLOAD LOGIC (STEP 3)
// =========================================================
function initExcelUpload(geoLevels) {
    const fileInput = document.getElementById('excel-file-input');
    const dropZone = document.getElementById('excel-drop-zone');
    const sheetSelect = document.getElementById('excel-sheet-select');
    const mappingTbody = document.getElementById('excel-mapping-tbody');
    const fileNameDisplay = document.getElementById('selected-file-name');

    const sheetArea = document.getElementById('sheet-selection-area');
    const mappingArea = document.getElementById('mapping-selection-area');

    if (!fileInput) return;

    // Reset UI
    fileNameDisplay.style.display = 'none';
    sheetArea.style.display = 'none';
    mappingArea.style.display = 'none';
    excelData = null;
    excelHeaders = [];
    excelMappings = {};

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        processExcelFile(file);
    };

    // Drag & Drop
    dropZone.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); };
    dropZone.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) processExcelFile(file);
    };

    function processExcelFile(file) {
        fileNameDisplay.textContent = `Selected: ${file.name}`;
        fileNameDisplay.style.display = 'block';

        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            excelWorkbook = workbook;

            // Populate sheets
            sheetSelect.innerHTML = '<option value="">— Select a Sheet —</option>';
            workbook.SheetNames.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                sheetSelect.appendChild(opt);
            });

            sheetArea.style.display = 'block';
        };
        reader.readAsArrayBuffer(file);
    }

    sheetSelect.onchange = () => {
        const sheetName = sheetSelect.value;
        if (!sheetName) {
            mappingArea.style.display = 'none';
            return;
        }

        const sheet = excelWorkbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        if (data.length > 0) {
            excelData = data;
            excelHeaders = Object.keys(data[0]);
            renderHeaderMapping(geoLevels);
            mappingArea.style.display = 'block';
        }
    };

    function renderHeaderMapping(levels) {
        mappingTbody.innerHTML = '';

        // Combine attributes from Step 2
        const fixedFields = ['Branch Code', 'Entity Category'];
        const hierarchyFields = levels;
        const lowestLevel = levels[levels.length - 1];

        // Custom attributes from Step 2 table
        const customAttrs = [];
        document.querySelectorAll('#dynamic-attr-tbody tr').forEach(row => {
            const nameInput = row.querySelector('.branch-attr-name');
            if (nameInput && !nameInput.disabled && nameInput.value.trim()) {
                customAttrs.push(nameInput.value.trim());
            }
        });

        // Unique set of attributes to map
        const allAttrs = [...new Set([...fixedFields, ...hierarchyFields, ...customAttrs])];

        allAttrs.forEach(attr => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #f1f3f5';

            row.innerHTML = `
                <td style="padding: 12px 16px; font-weight: 600; color: #111;">${attr}</td>
                <td style="padding: 12px 16px;">
                    <select class="excel-header-mapper cet-input" data-attr="${attr}" style="width: 100%; font-size: 13px; padding: 8px;">
                        <option value="">— Select Header —</option>
                        ${excelHeaders.map(h => `<option value="${h}">${h}</option>`).join('')}
                    </select>
                </td>
            `;
            mappingTbody.appendChild(row);
        });

        // Try to auto-map based on name similarity
        mappingTbody.querySelectorAll('.excel-header-mapper').forEach(select => {
            const attr = select.dataset.attr.toLowerCase();
            const match = excelHeaders.find(h => h.toLowerCase() === attr);
            if (match) select.value = match;

            select.onchange = () => {
                excelMappings[select.dataset.attr] = select.value;
            };
            // Initial trigger
            if (select.value) excelMappings[select.dataset.attr] = select.value;
        });
    }
}

function processExcelData(geoLevels) {
    if (!excelData || !excelMappings) return { data: null, mappings: null };

    const dynamicData = {
        regions: [],
        states: [],
        circles: [],
        clusters: [],
        branches: []
    };

    const dynamicMappings = {
        regionToState: [],
        stateToCircle: [],
        circleToCluster: [],
        clusterToBranch: [],
        userRoles: []
    };

    // Helper to generate a consistent ID
    const genId = (prefix, val) => prefix + '_' + val.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // Build unique sets for each level and track relationships
    const levelMaps = {
        region: new Map(),
        state: new Map(),
        circle: new Map(),
        cluster: new Map(),
        branch: new Map()
    };

    // Mapping key helper
    const getMappingKey = (parentType, childType) => {
        if (parentType === 'region' && childType === 'state') return 'regionToState';
        if (parentType === 'state' && childType === 'circle') return 'stateToCircle';
        if (parentType === 'circle' && childType === 'cluster') return 'circleToCluster';
        if (parentType === 'cluster' && childType === 'branch') return 'clusterToBranch';
        return null;
    };

    // Map geoLevels to canonical types
    const levelToType = geoLevels.map(l => GEO_LEVEL_MAP[l] || l.toLowerCase());

    excelData.forEach((row, rowIdx) => {
        let prevNode = null;

        levelToType.forEach((type, levelIdx) => {
            const levelName = geoLevels[levelIdx];
            const excelHeader = excelMappings[levelName];
            const value = row[excelHeader];

            if (!value) return;

            const id = genId(type, value);
            let node = levelMaps[type].get(id);

            if (!node) {
                node = { id, name: value, attributes: {} };

                // Capture all mapped attributes for this node
                // (Mostly relevant for the lowest level 'branch')
                Object.entries(excelMappings).forEach(([sysAttr, exHeader]) => {
                    if (row[exHeader] !== undefined) {
                        node.attributes[sysAttr] = row[exHeader];
                    }
                });

                levelMaps[type].set(id, node);

                // If this is the branch level, sync its value to "Branch Name" attribute
                if (type === 'branch') {
                    node.attributes['Branch Name'] = value;
                }

                const dataKey = type === 'branch' ? 'branches' : type + 's';
                if (dynamicData[dataKey]) dynamicData[dataKey].push(node);
            }

            // Relationship
            if (prevNode) {
                const mappingKey = getMappingKey(levelToType[levelIdx - 1], type);
                if (mappingKey) {
                    const exists = dynamicMappings[mappingKey].some(m => m.from === prevNode.id && m.to === id);
                    if (!exists) {
                        dynamicMappings[mappingKey].push({ from: prevNode.id, to: id });
                    }
                }
            }

            prevNode = node;
        });
    });

    return { data: dynamicData, mappings: dynamicMappings };
}

// Global Tab Mover
window.moveCetToTab = function (n) {
    // Update Stepper UI (Header)
    const tabs = document.querySelectorAll('.cet-tab');
    tabs.forEach((t, idx) => {
        const tIdx = idx + 1;
        const isActive = (tIdx === n);
        const isPast = (tIdx < n);

        t.classList.toggle('active', isActive);
        t.classList.toggle('completed', isPast);

        // Update Opacity & Pointer events
        t.style.opacity = (isActive || isPast) ? '1' : '0.5';
        t.style.pointerEvents = (isActive || isPast) ? 'auto' : 'none';

        // Update Title Color dynamically
        const titleEl = t.querySelector('div[style*="font-size:14px"]');
        if (titleEl) {
            titleEl.style.color = isActive ? '#e41837' : (isPast ? '#111' : '#374151');
        }

        // Icon/Number state
        const num = t.querySelector('.cet-tab-num');
        if (num) {
            if (isPast) {
                num.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
                num.style.background = '#e41837';
            } else if (isActive) {
                num.innerHTML = tIdx;
                num.style.background = '#e41837';
            } else {
                num.innerHTML = tIdx;
                num.style.background = '#9ca3af';
            }
        }
    });

    // Update Step Connectors (Arrows)
    const arrows = document.querySelectorAll('.cet-stepper-container > div[style*="width: 40px"]');
    arrows.forEach((arr, idx) => {
        arr.style.opacity = (n > idx + 1) ? '1' : '0.3';
    });

    // Toggle Panes
    document.querySelectorAll('.cet-tab-pane').forEach((p, idx) => {
        p.classList.toggle('active', (idx + 1) === n);
    });
};




// =========================================================
// ENTITY LIST MANAGEMENT (GLOBAL SCOPE)
// =========================================================
function renderEntityTypes() {
    const tbody = document.getElementById('entity-list-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Data-driven rendering from createdEntityTypes
    createdEntityTypes.forEach((ent, idx) => {
        const nodeCount = (ent.name === 'Retail Branch')
            ? (data.regions.length + data.states.length + data.circles.length + data.clusters.length + data.branches.length)
            : (ent.dynamicData ? Object.values(ent.dynamicData).reduce((acc, curr) => acc + curr.length, 0) : 0);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="text-align: center;">${idx + 1}</td>
            <td style="text-align: center;"><strong style="color:#111;">${ent.name}</strong></td>
            <td style="text-align: center;">
                <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; justify-content: center;">
                    ${ent.geoLevels.map((l, i) => `<span class="geo-tag">${l}</span>${i < ent.geoLevels.length - 1 ? '<span class="geo-arrow">&rarr;</span>' : ''}`).join('')}
                </div>
            </td>
            <td style="text-align: center;">
                <div style="font-weight:700; color:#4b5563;">${ent.attributes.length} Attributes</div>
                <div style="font-size:11px; color:#e41837; font-weight:600;">${nodeCount} Entities Total</div>
            </td>
            <td style="text-align: center; color:#6b7280; font-size:12px;">${ent.createdOn}</td>
            <td style="text-align: center; white-space:nowrap;">
                <button class="cet-icon-btn view" onclick="showViewEntity('${ent.name}', ${idx})" title="View Details">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="cet-icon-btn update" onclick="showUpdateEntity('${ent.name}', ${idx})" title="Update Configuration">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="cet-icon-btn delete" onclick="deleteEntityType('${ent.name}', ${idx})" title="Delete Entity Type">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function filterEntityTable(colIdx) {
    const table = document.getElementById('entity-type-table');
    const tbody = document.getElementById('entity-list-tbody');
    const searchInputs = table.querySelectorAll('.cet-table-search-input');
    const rows = tbody.getElementsByTagName('tr');

    for (let i = 0; i < rows.length; i++) {
        let show = true;
        for (let j = 0; j < searchInputs.length; j++) {
            const filter = searchInputs[j].value.toLowerCase();
            const td = rows[i].getElementsByTagName('td')[j];
            if (td) {
                const text = td.textContent || td.innerText;
                if (text.toLowerCase().indexOf(filter) === -1) {
                    show = false;
                    break;
                }
            }
        }
        rows[i].style.display = show ? '' : 'none';
    }
}

function showMasterAssessmentEntityList() {
    showPage('list-entity-page');
    renderEntityTypes();
}

// =========================================================
// ENTITY ATTRIBUTES (STEP 2) - BRANCH LEVEL EXCLUSIVE
// =========================================================
function renderAttributes(levels) {
    const tableContainer = document.getElementById('attributes-tables-container');
    const funnelContainer = document.getElementById('attr-mini-funnel');
    if (!tableContainer) return;

    const lowestLevel = levels[levels.length - 1];

    // Left Side context summary - Premium Timeline Look
    if (funnelContainer) {
        funnelContainer.innerHTML = `
            <div style="padding:20px; background:white; border:1px solid #eee; border-radius:16px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                <h4 style="margin:0 0 20px 0; font-size:14px; color:#111; font-weight:800; font-family:'Outfit'; text-transform:uppercase; letter-spacing:0.5px;"></h4>
                
                <div style="display:flex; flex-direction:column; position:relative; padding-left:4px;">
                    ${levels.map((lvl, i) => {
            const isLast = (i === levels.length - 1);
            return `
                            <div style="display:flex; gap:16px; align-items:flex-start; position:relative; padding-bottom:${isLast ? '0' : '20px'};">
                                ${!isLast ? `<div style="position:absolute; left:11px; top:24px; width:2px; height:calc(100% - 10px); background:${i < levels.length - 1 ? '#eee' : '#eee'}; z-index:0;"></div>` : ''}
                                
                                <div style="width:24px; height:24px; min-width:24px; border-radius:50%; background:${isLast ? '#e41837' : 'white'}; border:2.5px solid ${isLast ? '#e41837' : '#eee'}; display:flex; align-items:center; justify-content:center; z-index:1; box-shadow:${isLast ? '0 0 0 4px rgba(228,24,55,0.1)' : 'none'}; transition:all 0.3s;">
                                    ${isLast ?
                    `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` :
                    `<div style="width:6px; height:6px; background:#ddd; border-radius:50%;"></div>`
                }
                                </div>
                                
                                <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
                                    <span style="font-size:11px; font-weight:700; color:${isLast ? '#e41837' : '#9ca3af'}; transform:translateY(-2px);">${isLast ? 'BRANCH' : 'LEVEL ' + (i + 1)}</span>
                                    <span style="font-size:14px; font-weight:${isLast ? '800' : '600'}; color:${isLast ? '#111' : '#6b7280'};">${lvl}</span>
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
                
                <div style="margin-top:24px; padding-top:20px; border-top:1px dashed #eee;">
                    <p style="font-size:12px; color:#6b7280; line-height:1.6; margin:0;">
                        <span style="color:#e41837; font-weight:700;">Note:</span> System fields are locked to maintain data integrity across hierarchy levels.
                    </p>
                </div>
            </div>
        `;
    }

    tableContainer.innerHTML = '';

    const section = document.createElement('div');
    section.className = 'attribute-setup-section';
    section.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:16px; padding:0 4px;">
            <div>
                <h3 style="margin:0; font-size:20px; color:#111; font-weight:800; font-family:'Outfit';">Define Attributes for ${lowestLevel}</h3>
                <p style="margin:4px 0 0; font-size:13px; color:#6b7280;">Specify the data fields to be captured for this entity type.</p>
            </div>
            <button class="cet-create-btn" id="add-attr-btn-dynamic" style="padding:8px 16px; font-size:13px; background:#e41837; color:white; border:none;">+ Add Attribute</button>
        </div>
        <div style="background:white; border-radius:12px; border:1px solid #eee; overflow:hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.04);">
            <table class="cet-table" id="dynamic-attr-table">
                <thead>
                    <tr style="background:#fafafa;">
                        <th style="width:50%;">Attribute Name</th>
                        <th style="width:40%;">Attribute Type</th>
                        <th style="width:10%; text-align:right;">Actions</th>
                    </tr>
                </thead>
                <tbody id="dynamic-attr-tbody">
                    <!-- Rows will be added here -->
                </tbody>
            </table>
        </div>
    `;
    tableContainer.appendChild(section);

    const tbody = document.getElementById('dynamic-attr-tbody');
    const commonType = 'Alpha Numeric (250 Characters)';

    // Fixed System Field Defaults (Non-editable)
    const fixedFields = ['SOL ID', 'Entity Category'];

    // Dynamic Hierarchy Fields
    const hierarchyFields = levels.slice(0, -1);

    const addAttrRow = (name = '', type = commonType, isFixed = false) => {
        const row = document.createElement('tr');
        if (isFixed) row.style.background = '#fafafa';

        row.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="text" class="cet-input branch-attr-name" value="${name}" 
                        ${isFixed ? 'disabled' : ''} 
                        style="padding:10px 14px; font-size:14px; border-color:#f1f3f5; flex:1; ${isFixed ? 'background:#f3f4f6; color:#9ca3af; font-weight:600;' : ''}">
                    ${isFixed ? `<span style="font-size:9px; background:#e5e7eb; color:#6b7280; padding:2px 6px; border-radius:4px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">System</span>` : ''}
                </div>
            </td>
            <td>
                <select class="cet-input branch-attr-type" ${isFixed ? 'disabled' : ''} 
                    style="padding:10px 14px; font-size:14px; border-color:#f1f3f5; ${isFixed ? 'background:#f3f4f6; color:#9ca3af;' : ''}">
                    <option ${type === commonType ? 'selected' : ''}>${commonType}</option>
                    <option>Integer Number</option>
                    <option>Date</option>
                    <option>Boolean (Yes/No)</option>
                    <option>Large Text Area</option>
                </select>
            </td>
            <td style="text-align:right;">
                ${isFixed ?
                `<div style="width:34px; height:34px; display:flex; align-items:center; justify-content:center; color:#e5e7eb;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>` :
                `<button class="cet-icon-btn delete curr-row-del" style="width:34px; height:34px;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                    </button>`
            }
            </td>
        `;
        tbody.appendChild(row);

        const delBtn = row.querySelector('.curr-row-del');
        if (delBtn) {
            delBtn.onclick = () => {
                row.style.opacity = '0';
                row.style.transform = 'scale(0.95)';
                setTimeout(() => row.remove(), 200);
            };
        }
    };

    // Pre-populate
    fixedFields.forEach(name => addAttrRow(name, commonType, true));
    hierarchyFields.forEach(name => addAttrRow(name, commonType, true));

    // Handle Add Button
    document.getElementById('add-attr-btn-dynamic').onclick = () => addAttrRow();
}
window.renderAttributes = renderAttributes;



// =========================================================
// CUSTOM MODAL / POPUP SYSTEM
// =========================================================
function showCustomModal({ title, message, type = 'info', confirmText = 'OK', cancelText = 'Cancel', isHtml = false, onOpen = null }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-msg');
        const confirmBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        const iconWrap = document.getElementById('confirm-modal-icon');

        if (!modal) { resolve(false); return; }

        titleEl.textContent = title;
        if (isHtml) {
            msgEl.innerHTML = message;
        } else {
            msgEl.textContent = message;
        }
        confirmBtn.textContent = confirmText;
        cancelBtn.style.display = type === 'confirm' ? 'block' : 'none';

        // Icon theming
        if (iconWrap) {
            if (type === 'confirm') {
                iconWrap.innerHTML = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#e41837" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
                iconWrap.style.background = '#fff5f6';
                iconWrap.style.boxShadow = '0 0 0 4px #fff1f2';
            } else {
                iconWrap.innerHTML = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#e41837" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
                iconWrap.style.background = '#fff5f6';
                iconWrap.style.boxShadow = '0 0 0 4px #fff1f2';
            }
        }

        modal.style.display = 'flex';
        if (typeof onOpen === 'function') {
            onOpen();
        }

        const handleConfirm = () => {
            modal.style.display = 'none';
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(true);
        };

        const handleCancel = () => {
            modal.style.display = 'none';
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(false);
        };

        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
    });
}

window.showMasterAssessmentEntityList = function () {
    showPage('list-entity-page');
    renderEntityTypes();
};

window.showViewEntity = function (name, idx) {
    document.querySelectorAll('.main-page-box').forEach(p => p.style.display = 'none');
    document.getElementById('view-entity-page').style.display = 'block';
    document.getElementById('view-entity-name-header').innerText = name;

    const content = document.getElementById('view-entity-content');
    if (content) {
        const ent = createdEntityTypes[idx];

        content.innerHTML = `
            <div style="display: grid; grid-template-columns: 320px 1fr; gap: 40px; align-items: start; width: 100%; font-family: 'Outfit', sans-serif;">
                <!-- Left Sidebar: Hierarchy Visualization -->
                <div style="background: #fcfcfc; border-radius: 20px; padding: 32px; border: 1px solid #edf0f2; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
                    <h3 style="font-size: 15px; font-weight: 700; color: #111; margin-bottom: 28px; display: flex; align-items: center; gap: 10px; letter-spacing: 0.02em;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e41837" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
                        Hierarchy structure
                    </h3>
                    <div id="view-visual-inner" class="preview-card-list"></div>
                </div>

                <!-- Right Content Area -->
                <div style="display: flex; flex-direction: column; gap: 40px; width: 100%;">
                    <!-- Section 1: Distribution Stats -->
                    <div>
                        <h3 style="font-size: 18px; font-weight: 700; color: #111; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#e41837" stroke-width="2.5"><path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z"/></svg>
                            Operational node distribution
                        </h3>
                        <div id="view-stats-container"></div>
                    </div>

                    <!-- Section 2: Attributes Master List -->
                    <div>
                        <h3 style="font-size: 18px; font-weight: 700; color: #111; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#e41837" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                            Schema configuration details
                        </h3>
                        <div id="view-bullets-inner" style="background: white; border-radius: 16px; border: 1px solid #edf0f2; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03);"></div>
                    </div>
                </div>
            </div>
        `;

        renderDataStats(ent, document.getElementById('view-stats-container'));
        renderSummaryTo(ent.geoLevels, document.getElementById('view-visual-inner'), document.getElementById('view-bullets-inner'), ent.attributes);
    }
};

window.renderUpdateAttributes = function (geoLevels, existingAttrs) {
    const container = document.getElementById('update-attributes-tables-container');
    if (!container) return;
    container.innerHTML = '';

    const group = document.createElement('div');
    group.style.padding = '10px 0';

    let finalAttrs = existingAttrs || [];

    // Determine the fixed attributes based on the new geoLevels
    const hierarchyFields = [...geoLevels]; // All selected hierarchy levels are locked 
    const fixedNames = ['Branch Code', 'Branch Name', 'Entity Category', ...hierarchyFields];

    // Filter out obsolete hardcoded lowest-level attributes and fixed names to isolate purely custom attributes
    let customAttrs = (existingAttrs || []).filter(a =>
        !fixedNames.includes(a.name) &&
        !(a.name.endsWith(' Code') || (a.name.endsWith(' Name') && a.name !== 'Entity Name') || a.name.endsWith(' Type'))
    );

    const displayAttrs = [
        ...fixedNames.map(n => ({ name: n, type: n === 'Branch Code' ? 'ALPHA NUMERIC(250 Characters)' : 'ALPHA NUMERIC(250 Characters)', isFixed: true })),
        ...customAttrs.map(a => ({ ...a, isFixed: false }))
    ];

    group.innerHTML = `
        <div id="update-attr-rows-wrapper" style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px; background:#fafafa; padding:24px; border-radius:16px; border:1px solid #f1f3f5;">
            ${displayAttrs.map(attr => `
                <div class="attr-input-group" style="display:flex; flex-direction:column; gap:6px;">
                    <label style="font-size:11px; color:#6b7280; font-weight:700; text-transform:uppercase; letter-spacing:0.02em;">Field Name</label>
                    <input type="text" class="cet-input update-attr-name" value="${attr.name}" ${attr.isFixed ? 'readonly style="background:#f3f4f6; font-size:14px; border-color:#e5e7eb; color:#4b5563; font-weight:600; cursor:not-allowed;"' : 'style="font-size:14px; border-color:#d1d5db; background:white;"'}>
                </div>
                <div class="attr-input-group" style="display:flex; flex-direction:column; gap:6px; position:relative;">
                    <label style="font-size:11px; color:#6b7280; font-weight:700; text-transform:uppercase; letter-spacing:0.02em;">Data Type</label>
                    ${attr.isFixed
            ? `<input type="text" class="cet-input update-attr-type" value="${attr.type}" readonly style="background:#f3f4f6; font-size:14px; border-color:#e5e7eb; color:#4b5563; font-weight:600; cursor:not-allowed;">`
            : `<div style="display:flex; gap:8px; align-items:center;">
                           <select class="cet-input cet-select update-attr-type" style="flex:1; font-size:14px; border-color:#d1d5db; background:white;">
                               <option ${attr.type && attr.type.includes('ALPHA') ? 'selected' : ''}>ALPHA NUMERIC(250 Characters)</option>
                               <option ${attr.type && attr.type.includes('INTEGER') ? 'selected' : ''}>INTEGER NUMBER</option>
                               <option ${attr.type && attr.type.includes('DATE') ? 'selected' : ''}>DATE</option>
                           </select>
                           <button style="background:#fff1f2; border:1px solid #e4183733; color:#e41837; width:36px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onclick="this.parentElement.parentElement.previousElementSibling.remove(); this.parentElement.parentElement.remove();" title="Remove Field">
                               <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                           </button>
                       </div>`
        }
                </div>
            `).join('')}
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:20px;">
            <button class="action-btn" id="btn-update-add-custom-field" style="height:44px; padding:0 24px; border-radius:12px; display:flex; align-items:center; gap:10px; background:white; border:1.5px dashed #e4183766; color:#e41837; font-weight:700; transition:all 0.2s;" title="Add Custom Attribute">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
                Add New Field
            </button>
        </div>
    `;
    container.appendChild(group);

    const addBtn = document.getElementById('btn-update-add-custom-field');
    if (addBtn) {
        addBtn.onclick = () => {
            const wrapper = document.getElementById('update-attr-rows-wrapper');
            const nameGrp = document.createElement('div');
            nameGrp.className = 'attr-input-group';
            nameGrp.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
            nameGrp.innerHTML = `
                <label style="font-size:12px; color:#6b7280; font-weight:500;">Attribute Name</label>
                <input type="text" class="cet-input update-attr-name" placeholder="Field Name" style="font-size:14px; border-color:#e4183766;">
            `;
            const typeGrp = document.createElement('div');
            typeGrp.className = 'attr-input-group';
            typeGrp.style.cssText = 'display:flex; flex-direction:column; gap:8px; position:relative;';
            typeGrp.innerHTML = `
                <label style="font-size:12px; color:#6b7280; font-weight:500;">Attribute Type</label>
                <select class="cet-input cet-select update-attr-type" style="font-size:14px;">
                    <option>ALPHA NUMERIC(250 Characters)</option>
                    <option>INTEGER NUMBER</option>
                    <option>DATE</option>
                </select>
                <button style="position:absolute; right:-24px; top:36px; background:none; border:none; color:#e41837; cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center;" onclick="this.parentElement.previousElementSibling.remove(); this.parentElement.remove();" title="Remove Attribute">
                     <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            `;
            wrapper.appendChild(nameGrp);
            wrapper.appendChild(typeGrp);
        };
    }
};

window.switchUpdateTab = function (n) {
    document.querySelectorAll('#update-entity-page .cet-tab').forEach(t => {
        const tId = t.id;
        const isActive = tId === 'upd-tab-' + n;
        t.classList.toggle('active', isActive);

        const num = t.querySelector('.cet-tab-num');
        const titleEl = t.querySelector('div[style*="font-size:14px"]');
        const subEl = t.querySelector('div[style*="font-size:11px"]');

        if (isActive) {
            if (num) {
                num.style.background = '#e41837';
                num.style.color = 'white';
                num.style.boxShadow = '0 0 0 4px #fff1f2';
            }
            if (titleEl) titleEl.style.color = '#111';
            if (subEl) subEl.style.color = '#e41837';
        } else {
            if (num) {
                num.style.background = '#f3f4f6';
                num.style.color = '#9ca3af';
                num.style.boxShadow = 'none';
            }
            if (titleEl) titleEl.style.color = '#6b7280';
            if (subEl) subEl.style.color = '#9ca3af';
        }
    });

    // Update Step Connectors (Arrows) for Update Page
    const arrows = document.querySelectorAll('#update-entity-page .cet-stepper-container > div[style*="width: 40px"]');
    arrows.forEach((arr, idx) => {
        arr.style.opacity = (n > idx + 1) ? '1' : '0.3';
    });

    document.querySelectorAll('#update-entity-page .cet-tab-pane').forEach((p) => {
        p.classList.toggle('active', p.id === 'upd-pane-tab-' + n);
    });

    if (n === 3) {
        const ent = createdEntityTypes[editingEntityTypeIdx];
        renderUpdateExcelMapping(ent.geoLevels, ent.attributes);
    }
};

window.showUpdateEntity = function (name, idx) {
    editingEntityTypeIdx = idx; // Remember which record we are editing
    document.querySelectorAll('.main-page-box').forEach(p => p.style.display = 'none');
    document.getElementById('update-entity-page').style.display = 'block';

    // Always reset to tab 1
    switchUpdateTab(1);
    document.getElementById('update-entity-name-label').innerText = name;

    const ent = createdEntityTypes[idx];
    const nameInput = document.getElementById('update-entity-type-name');
    if (nameInput) nameInput.value = ent.name;

    // --- Stepper Control for Update Hierarchy ---
    const minusBtn = document.getElementById('upd-geo-level-minus');
    const plusBtn = document.getElementById('upd-geo-level-plus');
    const displayEl = document.getElementById('upd-geo-level-display');
    const countInput = document.getElementById('upd-geo-level-count');

    const updateUpdCount = (newCount) => {
        if (newCount < 2) newCount = 2;
        if (newCount > 6) newCount = 6;
        if (countInput) countInput.value = newCount;
        if (displayEl) displayEl.textContent = newCount;

        // Trigger re-render of levels
        const currentLevels = ent.geoLevels.slice(0, newCount - 1).concat(['Branch']);
        renderUpdateUI(currentLevels);
    };

    if (minusBtn) minusBtn.onclick = () => updateUpdCount(parseInt(countInput.value) - 1);
    if (plusBtn) plusBtn.onclick = () => updateUpdCount(parseInt(countInput.value) + 1);

    // Initial state
    if (countInput) {
        countInput.value = ent.geoLevels.length;
        if (displayEl) displayEl.textContent = ent.geoLevels.length;
    }

    const container = document.getElementById('update-geo-levels-container');
    const preview = document.getElementById('update-hierarchy-preview');

    const renderUpdateUI = (levels) => {
        if (container) {
            container.innerHTML = '';
            levels.forEach((lvl, i) => {
                const isLast = i === levels.length - 1;
                const row = document.createElement('div');
                row.className = 'geo-level-row';
                row.style.cssText = 'background:white; border:1px solid #eee; border-radius:12px; padding:16px; margin-bottom:12px; transition:all 0.2s;';

                row.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <label style="font-size:11px; font-weight:800; color:#6b7280; letter-spacing:0.02em;">Level ${i + 1} designation ${isLast ? '(Locked)' : ''}</label>
                        ${isLast ? '<span style="font-size:10px; color:#e41837; font-weight:700; background:#fff1f2; padding:2px 8px; border-radius:12px;">Base entity</span>' : ''}
                    </div>
                    <select class="cet-input cet-select update-geo-select" data-level="${i + 1}" 
                        style="width:100%; font-size:14px; font-weight:600; border-color:#f1f3f5; border-radius:8px;"
                        ${isLast ? 'disabled' : ''}>
                        ${GEOGRAPHY_OPTIONS.map(opt => `<option value="${opt}" ${opt === lvl ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                `;
                container.appendChild(row);

                const select = row.querySelector('select');
                if (select) {
                    select.onchange = () => {
                        const newLevels = Array.from(container.querySelectorAll('select')).map(s => s.value);
                        renderUpdateSummary(newLevels);
                        renderUpdateAttributes(newLevels, ent.attributes);
                    };
                }
            });
        }
        renderUpdateSummary(levels);
        renderUpdateAttributes(levels, ent.attributes);
    };

    const renderUpdateSummary = (levels) => {
        if (!preview) return;
        preview.innerHTML = '';
        const ent = createdEntityTypes[editingEntityTypeIdx];

        // Graphical Stats Header
        const statsHeader = document.createElement('div');
        statsHeader.innerHTML = `
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 16px; font-weight: 700; color: #111; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#e41837" stroke-width="2.5"><path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z"/></svg>
                Current node distribution
            </h3>
        `;
        preview.appendChild(statsHeader);

        const statsGrid = document.createElement('div');
        statsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; margin-bottom: 40px; width: 100%;';
        preview.appendChild(statsGrid);

        levels.forEach((lvl, i) => {
            // Count logic for existing nodes
            let count = 0;
            const lvlType = lvl.toLowerCase();
            if (ent.name === 'Retail Branch') {
                const dataKey = lvlType === 'branch' ? 'branches' : lvlType + 's';
                if (data[dataKey]) count = data[dataKey].length;
            } else if (ent.dynamicData) {
                const dataKey = lvlType === 'branch' ? 'branches' : lvlType + 's';
                if (ent.dynamicData[dataKey]) count = ent.dynamicData[dataKey].length;
            }

            const statBox = document.createElement('div');
            statBox.style.cssText = 'background:white; border:1.5px solid #f1f3f5; border-radius:16px; padding:20px; text-align:left; box-shadow: 0 4px 6px rgba(0,0,0,0.02); font-family: "Outfit", sans-serif; min-width: 0;';
            statBox.innerHTML = `
                <div style="font-size:11px; font-weight:700; color:#6b7280; letter-spacing:0.05em; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lvl}</div>
                <div style="display:flex; align-items:baseline; gap:6px;">
                    <span style="font-family: 'Inter', sans-serif; font-size:28px; font-weight:800; color:#111; line-height:1;">${count}</span>
                    <span style="font-family: 'Inter', sans-serif; font-size:10px; color:#9ca3af; font-weight:600;">Nodes</span>
                </div>
                <div style="width: 20px; height: 3px; background: #e41837; margin-top: 12px; border-radius: 2px; opacity: 0.6;"></div>
            `;
            statsGrid.appendChild(statBox);
        });

        // Hierarchy Visualization Title
        const vizTitle = document.createElement('h3');
        vizTitle.style.cssText = 'font-family: "Outfit", sans-serif; font-size: 16px; font-weight: 700; color: #111; margin-bottom: 20px; border-top: 1px solid #eee; padding-top: 32px;';
        vizTitle.innerText = 'Hierarchy map visualization';
        const vizFlow = document.createElement('div');
        vizFlow.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:0; padding:20px; background:white; border-radius:12px;';
        preview.appendChild(vizFlow);

        const colors = ['#e41837', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#059669'];

        levels.forEach((lvl, i) => {
            const isLast = (i === levels.length - 1);
            const color = colors[i % colors.length];

            const card = document.createElement('div');
            card.style.cssText = `width:100%; background:white; border:1.5px solid #edf0f2; border-left:4px solid ${color}; border-radius:12px; padding:16px 24px; display:flex; align-items:center; gap:20px; transition:all 0.3s; position:relative; box-shadow:0 2px 4px rgba(0,0,0,0.02);`;

            card.innerHTML = `
                <div style="width:40px; height:40px; background:${color}10; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${color}" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </div>
                <div style="flex:1;">
                    <div style="font-size:16px; font-weight:700; color:#111;">${lvl}</div>
                    <div style="font-size:12px; color:#6b7280;">${i === 0 ? 'Top level - Parent of all' : `Under ${levels[i - 1]}`}</div>
                </div>
                <div style="background:${color}; color:white; font-size:10px; font-weight:800; padding:4px 10px; border-radius:6px; letter-spacing:0.02em;">Level ${i + 1}</div>
            `;
            vizFlow.appendChild(card);

            if (!isLast) {
                const connector = document.createElement('div');
                connector.style.cssText = 'width:2px; height:24px; border-left:2px dashed #d1d5db; margin:4px 0;';
                vizFlow.appendChild(connector);
            }
        });

        const legend = document.createElement('div');
        legend.style.cssText = 'margin-top:24px; display:flex; align-items:center; gap:24px; padding-top:16px; border-top:1px solid #f3f4f6; width:100%; justify-content:flex-start;';
        legend.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; font-size:11px; color:#6b7280;">
                <span style="letter-spacing:2px; font-weight:700; color:#d1d5db;">-----</span> Indicates parent &rarr; child relationship
            </div>
            <div style="display:flex; align-items:center; gap:8px; font-size:11px; color:#6b7280;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                Data flows from top to bottom
            </div>
        `;
        preview.appendChild(legend);
    };

    renderUpdateUI(ent.geoLevels);

    // --- Excel Upload Listeners for Update Page ---
    initUpdateExcelListeners();
};

// Reads updated name + geoLevels from the Update form and persists them to createdEntityTypes
window.saveEntityTypeUpdate = function () {
    if (editingEntityTypeIdx < 0 || editingEntityTypeIdx >= createdEntityTypes.length) {
        showCustomModal({ title: 'Error', message: 'Could not identify the entity type being updated. Please try again.', type: 'info' });
        return;
    }

    const nameInput = document.getElementById('update-entity-type-name');
    const container = document.getElementById('update-geo-levels-container');
    const newName = nameInput ? nameInput.value.trim() : '';
    if (!newName) {
        showCustomModal({ title: 'Validation Error', message: 'Entity Type name cannot be empty.', type: 'info' });
        return;
    }

    const selects = container ? container.querySelectorAll('select') : [];
    const newLevels = Array.from(selects).map(s => s.value).filter(Boolean);
    if (newLevels.length === 0) {
        showCustomModal({ title: 'Validation Error', message: 'Please define at least one hierarchy level.', type: 'info' });
        return;
    }

    // Extract updated attributes
    const attrRows = document.querySelectorAll('#update-attr-rows-wrapper > div.attr-input-group:nth-child(even)'); // We can just iterate the name inputs
    const nameInputs = document.querySelectorAll('#update-attr-rows-wrapper .update-attr-name');
    const typeSelects = document.querySelectorAll('#update-attr-rows-wrapper .update-attr-type');

    const updatedAttrs = [];
    for (let i = 0; i < nameInputs.length; i++) {
        const n = nameInputs[i].value.trim();
        const t = typeSelects[i].value;
        if (n) {
            updatedAttrs.push({ name: n, type: t });
        }
    }

    // Persist changes
    createdEntityTypes[editingEntityTypeIdx].name = newName;
    createdEntityTypes[editingEntityTypeIdx].geoLevels = newLevels;
    createdEntityTypes[editingEntityTypeIdx].attributes = updatedAttrs;

    // Re-render the list
    renderEntityTypes();

    // Re-sync mapping page if the updated entity is the currently active one
    if (selectedEntityType) {
        const newlyCreatedKey = newName.toLowerCase().replace(/\s+/g, '_');
        // Check if we just updated the name of the entity that is currently selected
        const prevEntity = createdEntityTypes[editingEntityTypeIdx];
        const oldKey = prevEntity ? prevEntity.name.toLowerCase().replace(/\s+/g, '_') : '';

        if (selectedEntityType === oldKey) {
            selectedEntityType = newlyCreatedKey; // Sync the selection key
        }

        const activeConfig = getActiveEntityConfig();
        if (activeConfig && (activeConfig.name === newName || newlyCreatedKey === selectedEntityType)) {
            syncMappingColumnsToEntityType();
            renderLists(); // Refresh data with new columns
        }
    }

    editingEntityTypeIdx = -1;
    showMasterAssessmentEntityList();
    showCustomModal({ title: 'Update Successful', message: `"${newName}" has been updated successfully.`, type: 'info' });
};

window.deleteEntityType = async function (name, idx) {
    const confirmed = await showCustomModal({
        title: 'Confirm Deletion',
        message: `Are you sure you want to delete the "${name}" entity type? This action will remove all configuration levels and associated attributes permanently.`,
        type: 'confirm',
        confirmText: 'Yes, Delete',
        cancelText: 'Cancel'
    });

    if (confirmed) {
        createdEntityTypes.splice(idx, 1);
        renderEntityTypes();
        // If user is on the mapping page, re-sync columns
        const mainPage = document.getElementById('main-page-box');
        if (mainPage && mainPage.style.display !== 'none') {
            syncMappingColumnsToEntityType();
            renderLists();
        }
        showCustomModal({
            title: 'Action Successful',
            message: `"${name}" entity type has been successfully removed.`,
            type: 'info'
        });
    }
};
function renderSummaryTo(geoLevels, visual, bullets, customAttrs = []) {
    if (!visual || !bullets) return;
    visual.innerHTML = '';
    bullets.innerHTML = '';

    visual.style.display = 'flex';
    visual.style.flexDirection = 'column';
    visual.style.alignItems = 'center';
    visual.style.gap = '0';
    visual.style.padding = '12px';
    visual.style.background = 'white';
    visual.style.borderRadius = '16px';
    visual.style.border = '1px solid #edf0f2';

    const colors = ['#e41837', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#059669'];

    geoLevels.forEach((level, idx) => {
        const i = idx + 1;
        const isLast = (idx === geoLevels.length - 1);
        const color = colors[idx % colors.length];

        const card = document.createElement('div');
        card.style.cssText = `width:100%; background:#fcfcfc; border:1px solid #edf0f2; border-left:3px solid ${color}; border-radius:10px; padding:12px 16px; display:flex; align-items:center; gap:16px; transition:all 0.3s; position:relative;`;

        card.innerHTML = `
            <div style="width:32px; height:32px; background:${color}10; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${color}" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </div>
            <div style="flex:1;">
                <div style="font-size:14px; font-weight:700; color:#111;">${level}</div>
                <div style="font-size:10px; color:#6b7280;">${idx === 0 ? 'Top level - Parent of all' : `Under ${geoLevels[idx - 1]}`}</div>
            </div>
            <div style="background:${color}; color:white; font-size:9px; font-weight:800; padding:2px 8px; border-radius:4px;">Level ${i}</div>
        `;
        visual.appendChild(card);

        if (!isLast) {
            const connector = document.createElement('div');
            connector.style.cssText = 'width:2px; height:16px; border-left:2px dashed #d1d5db; margin:2px 0;';
            visual.appendChild(connector);
        }
    });

    const legend = document.createElement('div');
    legend.style.cssText = 'margin-top:16px; display:flex; flex-direction:column; gap:8px; padding-top:12px; border-top:1px solid #f3f4f6; width:100%;';
    legend.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; font-size:9px; color:#9ca3af;">
            <span style="letter-spacing:1px; font-weight:700; color:#d1d5db;">---</span> Parent &rarr; Child relationship
        </div>
    `;
    visual.appendChild(legend);

    const lowestLevel = geoLevels[geoLevels.length - 1];
    const commonType = 'Alpha Numeric (250 Characters)';
    const fixedFields = ['Branch Code', 'Entity Category'];
    const hierarchyFields = geoLevels.slice(0, -1);

    const attributeMap = new Map();
    [...fixedFields, ...hierarchyFields].forEach(name => {
        attributeMap.set(name, commonType);
    });

    customAttrs.forEach(attr => {
        const name = typeof attr === 'string' ? attr : attr.name;
        const type = typeof attr === 'string' ? commonType : (attr.type || commonType);
        if (name && name.trim()) attributeMap.set(name.trim(), type);
    });

    const entries = Array.from(attributeMap.entries());

    bullets.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-family: 'Inter', sans-serif;">
            <thead style="background: #f9fafb; border-bottom: 1.5px solid #edf0f2;">
                <tr>
                    <th style="padding: 18px 24px; font-size: 11px; font-weight: 800; color: #6b7280; letter-spacing: 0.05em;">Attribute field name</th>
                    <th style="padding: 18px 24px; font-size: 11px; font-weight: 800; color: #6b7280; letter-spacing: 0.05em; text-align: right;">System data format</th>
                </tr>
            </thead>
            <tbody>
                ${entries.map(([fieldName, fieldType], idx) => `
                    <tr style="border-bottom: ${idx === entries.length - 1 ? 'none' : '1px solid #f3f5f7'}; transition: background 0.2s;">
                        <td style="padding: 18px 24px; font-size: 14px; font-weight: 600; color: #111;">${fieldName}</td>
                        <td style="padding: 18px 24px; text-align: right;">
                            <span style="font-weight: 800; font-size: 10px; color: #e41837; background: #fff1f2; padding: 5px 12px; border-radius: 20px; letter-spacing: 0.5px;">${fieldType.replace('(250 Characters)', '250CH')}</span>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}


// --- Updated renderSummary inside Form to use renderSummaryTo ---
window.renderSummary = function (geoLevels) {
    const customAttrs = [];
    document.querySelectorAll('#dynamic-attr-tbody tr').forEach(row => {
        const nameInput = row.querySelector('.branch-attr-name');
        const typeSelect = row.querySelector('.branch-attr-type');
        if (nameInput && !nameInput.disabled && nameInput.value.trim()) {
            customAttrs.push({
                name: nameInput.value.trim(),
                type: typeSelect ? typeSelect.value : 'Alpha Numeric (250 Characters)'
            });
        }
    });
    renderSummaryTo(geoLevels, document.getElementById('summary-hierarchy-visual'), document.getElementById('summary-attributes-bullets'), customAttrs);
};



// =========================================================
// ADMIN VERTICAL DROPDOWN
// =========================================================
function initAdminDropdown() {
    const btn = document.getElementById('admin-nav-btn');
    const panel = document.getElementById('admin-dropdown-panel');
    const chev = document.getElementById('admin-chevron');
    if (!btn || !panel) return;

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const isOpen = panel.classList.contains('open');
        panel.classList.toggle('open', !isOpen);
        chev && chev.classList.toggle('rotated', !isOpen);
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
        if (!btn.contains(e.target) && !panel.contains(e.target)) {
            panel.classList.remove('open');
            chev && chev.classList.remove('rotated');
        }
    });

    // Allow nested section toggles within the admin panel
    const sectionToggles = panel.querySelectorAll('.admin-section-toggle');
    sectionToggles.forEach(toggle => {
        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            const targetId = this.dataset.target;
            const targetGroup = document.getElementById(targetId);
            if (!targetGroup) return;
            const isOpen = targetGroup.classList.toggle('open');
            this.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            const chevron = this.querySelector('.chevron-xs');
            if (chevron) {
                chevron.classList.toggle('rotated', isOpen);
            }
        });
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            panel.classList.remove('open');
            chev && chev.classList.remove('rotated');
        }
    });
}

// =========================================================
// DEMO LANDING PAGE
// =========================================================
const DEMO_USER = {
    name: 'Demo User',
    empId: 'EMP00001',
    email: 'EMP00001@demomahindrafinance.com'
};

const MODULE_LABELS = {
    boeg: 'BOEG Module',
    sq: 'Service Quality Module (SQ)',
    lens: 'LENS Module',
    control: 'Control 360',
    uigf: 'UIGF Module'
};

function initDemoLanding() {
    // Populate default user ticket with BOEG as initial logged in state
    updateUserTicket('boeg', 'Assessor', false);

    // Set BOEG ticket as initially logged in visually
    const boegTicket = document.querySelector('.module-ticket[data-module="boeg"]');
    if (boegTicket) {
        boegTicket.classList.add('logged-in');
        const loginBtn = boegTicket.querySelector('.module-login-btn');
        if (loginBtn) {
            loginBtn.textContent = '✓ Logged In';
            loginBtn.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
            loginBtn.style.boxShadow = '0 3px 10px rgba(22,163,74,0.35)';
        }
    }

    // Hover logic: only updates information, NOT the theme/color
    document.querySelectorAll('.module-ticket').forEach(function (card) {
        const mod = card.dataset.module;
        card.addEventListener('mouseenter', function () {
            const loginBtn = card.querySelector('.module-login-btn');
            const role = loginBtn ? loginBtn.dataset.role : '';
            // Pass true for isHover to skip color/theme updates
            updateUserTicket(mod, role, true);
        });
        card.addEventListener('mouseleave', function () {
            // Revert info to currently logged-in module
            const active = document.querySelector('.module-ticket.logged-in');
            if (active) {
                const lb = active.querySelector('.module-login-btn');
                updateUserTicket(active.dataset.module, lb ? lb.dataset.role : '', false);
            } else {
                updateUserTicket(null, null);
            }
        });
    });

    // Login buttons with Loader transition
    document.querySelectorAll('.module-login-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const mod = btn.dataset.module;
            const role = btn.dataset.role;

            // Show loader
            const loader = document.getElementById('module-loader');
            if (loader) loader.style.display = 'flex';

            // Brief delay for the "processing" vibe
            setTimeout(function () {
                if (loader) loader.style.display = 'none';

                // Reset all tickets and buttons
                document.querySelectorAll('.module-ticket').forEach(function (c) {
                    c.classList.remove('logged-in');
                    const b = c.querySelector('.module-login-btn');
                    if (b) {
                        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Login';
                        b.disabled = false;
                        b.style.background = '';
                        b.style.boxShadow = '';
                    }
                });

                // Mark this ticket as active
                btn.closest('.module-ticket').classList.add('logged-in');

                // Update ticket permanently (including theme)
                updateUserTicket(mod, role, false);

                // Animate login button
                btn.textContent = '✓ Logged In';
                btn.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
                btn.style.boxShadow = '0 3px 10px rgba(22,163,74,0.35)';

                console.log(`Successfully switched to module: ${mod}`);
            }, 800);
        });
    });
}

function updateUserTicket(mod, role, isHover) {
    const ticket = document.getElementById('demo-user-ticket');
    const avatarEl = document.getElementById('dut-avatar');
    const nameEl = document.getElementById('dut-name');
    const empidEl = document.getElementById('dut-empid');
    const emailEl = document.getElementById('dut-email');
    const moduleEl = document.getElementById('dut-module');
    const roleEl = document.getElementById('dut-role');
    const statusEl = document.getElementById('dut-status');
    const lastLoginEl = document.getElementById('dut-lastlogin');
    const barcodeEl = document.getElementById('dut-barcode-text');

    if (!ticket) return;

    if (!mod) {
        // Reset state
        ticket.classList.remove('module-boeg', 'module-admin', 'module-reports', 'module-sq', 'module-lens', 'module-control', 'module-uigf');
        if (avatarEl) { avatarEl.textContent = 'D'; }
        if (nameEl) nameEl.textContent = 'Demo User';
        if (empidEl) empidEl.textContent = 'SAP ID: —';
        if (emailEl) emailEl.textContent = 'demo@demomahindrafinance.com';
        if (moduleEl) moduleEl.textContent = '— Not Selected —';
        if (roleEl) roleEl.textContent = '— Not Assigned —';
        if (statusEl) {
            statusEl.textContent = 'Pending Login';
            statusEl.className = 'dut-badge dut-badge-pending';
        }
        if (lastLoginEl) lastLoginEl.textContent = '—';
        if (barcodeEl) barcodeEl.textContent = 'MMFSL-DEMO-0000';
        return;
    }

    // Apply module theming ONLY if NOT hovering
    if (!isHover) {
        ticket.classList.remove('module-boeg', 'module-admin', 'module-reports', 'module-sq', 'module-lens', 'module-control', 'module-uigf');
        ticket.classList.add('module-' + mod);
    }

    const user = DEMO_USER;
    const initials = user.name.split(' ').map(function (w) { return w[0]; }).join('');
    const now = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const loginStr = pad(now.getDate()) + '-' + pad(now.getMonth() + 1) + '-' + now.getFullYear() +
        ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = user.name;
    if (empidEl) empidEl.textContent = 'SAP ID: ' + user.empId;
    if (emailEl) emailEl.textContent = user.email;
    if (moduleEl) moduleEl.textContent = MODULE_LABELS[mod] || mod;
    if (roleEl) roleEl.textContent = role || '—';
    if (barcodeEl) barcodeEl.textContent = 'MMFSL-' + mod.toUpperCase() + '-' + user.empId.replace('EMP', '');

    if (isHover) {
        if (statusEl) {
            statusEl.textContent = 'Previewing Info';
            statusEl.className = 'dut-badge dut-badge-pending';
        }
    } else {
        if (statusEl) {
            statusEl.textContent = 'Active Session';
            statusEl.className = 'dut-badge dut-badge-active';
        }
        if (lastLoginEl) lastLoginEl.textContent = loginStr;
    }
}

// =========================================================
// FINAL SETUP
// =========================================================
function setup() {
    if (isAppInitialized) return;
    isAppInitialized = true;
    initDOMElements();
    bindEvents();
    init();
    populateHeaderEntitySelect();
    initNavigation();
    initCreateEntityForm();
    initUserUploadPage();
    initEntityMasterUploadPage();
    initHolidayModule();
    renderEntityTypes();
    initAdminDropdown();
    initDemoLanding();

    // Default landing: show demo landing page
    showPage('demo-landing-page');
}

function resetCetForm() {
    window.moveCetToTab(1);
    document.querySelectorAll('.cet-tab').forEach((t, idx) => {
        if (idx > 0) t.classList.add('disabled');
    });

    // Reset fields
    const nameEl = document.getElementById('entity-type-name');
    const geoCountEl = document.getElementById('geo-level-count');
    const geoContainer = document.getElementById('geo-levels-container');

    if (nameEl) nameEl.value = '';
    if (geoCountEl) {
        geoCountEl.value = '4';
        geoCountEl.dispatchEvent(new Event('change'));
    }

    // Reset Excel State
    excelData = null;
    excelWorkbook = null;
    excelHeaders = [];
    excelMappings = {};

    // Reset Excel UI
    const fileInput = document.getElementById('excel-file-input');
    const fileNameDisplay = document.getElementById('selected-file-name');
    const sheetArea = document.getElementById('sheet-selection-area');
    const mappingArea = document.getElementById('mapping-selection-area');

    if (fileInput) fileInput.value = '';
    if (fileNameDisplay) { fileNameDisplay.textContent = ''; fileNameDisplay.style.display = 'none'; }
    if (sheetArea) sheetArea.style.display = 'none';
    if (mappingArea) mappingArea.style.display = 'none';
}


function initUpdateExcelListeners() {
    const fileInput = document.getElementById('upd-excel-file-input');
    const dropZone = document.getElementById('upd-excel-drop-zone');
    const fileNameDisplay = document.getElementById('upd-selected-file-name');

    if (!fileInput || !dropZone) return;

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            fileNameDisplay.textContent = `Selected: ${file.name}`;
            fileNameDisplay.style.display = 'block';
            handleUpdateExcelFile(file);
        }
    };

    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = '#e41837'; };
    dropZone.ondragleave = () => { dropZone.style.borderColor = '#e5e7eb'; };
    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#e5e7eb';
        const file = e.dataTransfer.files[0];
        if (file) {
            fileNameDisplay.textContent = `Selected: ${file.name}`;
            fileNameDisplay.style.display = 'block';
            handleUpdateExcelFile(file);
        }
    };
}

function handleUpdateExcelFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1 });

        if (sheetData.length > 0) {
            excelHeaders = sheetData[0];
            excelData = sheetData.slice(1);
            document.getElementById('upd-mapping-area').style.display = 'block';
            const ent = createdEntityTypes[editingEntityTypeIdx];
            renderUpdateExcelMapping(ent.geoLevels, ent.attributes);
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderUpdateExcelMapping(levels, customAttributes) {
    const tbody = document.getElementById('upd-excel-mapping-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const fixedFields = ['Branch Code', 'Entity Category'];
    const fields = [...fixedFields, ...levels];

    fields.forEach(field => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="padding:10px; border-bottom:1px solid #eee; font-weight:600; color:#374151;">${field}</td>
            <td style="padding:10px; border-bottom:1px solid #eee;">
                <select class="cet-input upd-mapping-select" data-field="${field}" style="width:100%; font-size:12px;">
                    <option value="">-- Select Header --</option>
                    ${excelHeaders.map(h => `<option value="${h}">${h}</option>`).join('')}
                </select>
            </td>
        `;
        tbody.appendChild(row);
    });
}

window.processUpdateExcel = function () {
    if (!excelData || excelData.length === 0) {
        showCustomModal({ title: 'Error', message: 'No Excel data found. Please upload a file first.', type: 'info' });
        return;
    }

    const mappings = {};
    document.querySelectorAll('.upd-mapping-select').forEach(sel => {
        if (sel.value) mappings[sel.dataset.field] = excelHeaders.indexOf(sel.value);
    });

    // More robust level gathering for Update
    const levelElements = document.querySelectorAll('.upd-geo-level-select');
    const levels = Array.from(levelElements).map(s => s.value).filter(v => v && v.trim() !== "");

    if (levels.length === 0) {
        showCustomModal({ title: 'Missing Information', message: 'I couldn\'t find any hierarchy levels defined in Step 1. Please ensure Step 1 has at least one level named.', type: 'info' });
        return;
    }

    const stats = [];
    levels.forEach(lvl => {
        const colIdx = mappings[lvl];
        let count = 0;
        if (colIdx !== undefined) {
            const uniqueNodes = new Set();
            excelData.forEach(row => {
                if (row[colIdx]) uniqueNodes.add(row[colIdx]);
            });
            count = uniqueNodes.size;
        }
        stats.push({ name: lvl, count: count });
    });

    const container = document.getElementById('upd-upload-stats-container');
    const section = document.getElementById('upd-upload-stats-section');
    if (container && section) {
        section.style.display = 'block';
        if (stats.length === 0) {
            container.innerHTML = '<p style="color:#6b7280; font-size:13px; padding:20px; text-align:center; background:#f9fafb; border-radius:12px; border:1px dashed #eee;">No data to display. Check your mappings above.</p>';
        } else {
            container.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; width: 100%;">
                    ${stats.map(s => `
                        <div style="background:#fcfcfc; border:1.5px solid #e41837; border-radius:16px; padding:20px; text-align:left; box-shadow: 0 4px 6px rgba(228,24,55,0.05); font-family: 'Outfit', sans-serif;">
                            <div style="font-size:11px; font-weight:700; color:#6b7280; letter-spacing:0.05em; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.name}</div>
                            <div style="display:flex; align-items:baseline; gap:6px;">
                                <span style="font-family: 'Inter', sans-serif; font-size:28px; font-weight:800; color:#e41837; line-height:1;">${s.count}</span>
                                <span style="font-family: 'Inter', sans-serif; font-size:10px; color:#9ca3af; font-weight:600;">Nodes</span>
                            </div>
                            <div style="width: 20px; height: 3px; background: #e41837; margin-top: 12px; border-radius: 2px;"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        section.scrollIntoView({ behavior: 'smooth' });
    }
};


function renderDataStats(ent, container) {
    if (!container) return;

    const stats = [];
    ent.geoLevels.forEach(lvl => {
        let count = 0;
        const lvlType = lvl.toLowerCase();
        if (ent.name === 'Retail Branch') {
            const dataKey = lvlType === 'branch' ? 'branches' : lvlType + 's';
            if (data[dataKey]) count = data[dataKey].length;
        } else if (ent.dynamicData) {
            const dataKey = lvlType === 'branch' ? 'branches' : lvlType + 's';
            if (ent.dynamicData[dataKey]) count = ent.dynamicData[dataKey].length;
        }
        stats.push({ name: lvl, count: count });
    });

    const statsHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:16px;">
            ${stats.map(s => `
                <div style="background:white; border:1.5px solid #f1f3f5; border-radius:16px; padding:24px; text-align:left; transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(0,0,0,0.02); font-family: 'Outfit', sans-serif;">
                    <div style="font-size:11px; font-weight:700; color:#6b7280; letter-spacing:0.05em; margin-bottom:12px;">${s.name}</div>
                    <div style="display:flex; align-items:baseline; gap:8px;">
                        <span style="font-size:32px; font-weight:800; color:#111; line-height:1;">${s.count}</span>
                        <span style="font-size:11px; color:#9ca3af; font-weight:600; letter-spacing:0.02em;">Nodes</span>
                    </div>
                    <div style="width: 24px; height: 3px; background: #e41837; margin-top: 16px; border-radius: 2px; opacity: 0.6;"></div>
                </div>
            `).join('')}
        </div>
    `;

    container.innerHTML = statsHTML;
}

window.processCreateExcel = function () {
    if (!excelData || excelData.length === 0) {
        showCustomModal({ title: 'Error', message: 'No Excel data found. Please upload a file first.', type: 'info' });
        return;
    }

    const mappings = {};
    const mappingSelects = document.querySelectorAll('#excel-mapping-tbody select');
    let mappedCount = 0;

    mappingSelects.forEach(sel => {
        if (sel.value) {
            mappings[sel.dataset.field] = excelHeaders.indexOf(sel.value);
            mappedCount++;
        }
    });

    if (mappedCount === 0) {
        showCustomModal({ title: 'Mapping Required', message: 'Please map at least one Excel header to a hierarchy level before processing.', type: 'info' });
        return;
    }

    const levelSelects = document.querySelectorAll('.geo-level-select');
    const levels = Array.from(levelSelects).map(s => s.value).filter(v => v && v.trim() !== "");

    const stats = [];
    levels.forEach(lvl => {
        const colIdx = mappings[lvl];
        let countVal = 0;
        if (colIdx !== undefined && colIdx !== -1) {
            const uniqueNodes = new Set();
            excelData.forEach(row => {
                const val = row[colIdx];
                if (val !== undefined && val !== null && String(val).trim() !== "") {
                    uniqueNodes.add(String(val).trim());
                }
            });
            countVal = uniqueNodes.size;
        }
        stats.push({ name: lvl, count: countVal });
    });

    const container = document.getElementById('create-upload-stats-container');
    const section = document.getElementById('create-upload-stats-section');
    if (container && section) {
        section.style.display = 'block';
        if (stats.length === 0) {
            container.innerHTML = '<p style="color:#6b7280; font-size:13px; padding:20px; text-align:center; background:#f9fafb; border-radius:12px; border:1px dashed #eee;">No data to display. Check your mappings above.</p>';
        } else {
            container.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; width: 100%;">
                    ${stats.map(s => `
                        <div style="background:#fcfcfc; border:1.5px solid #e41837; border-radius:16px; padding:20px; text-align:left; box-shadow: 0 4px 6px rgba(228,24,55,0.05); font-family: 'Outfit', sans-serif;">
                            <div style="font-size:11px; font-weight:700; color:#6b7280; letter-spacing:0.05em; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.name}</div>
                            <div style="display:flex; align-items:baseline; gap:6px;">
                                <span style="font-family: 'Inter', sans-serif; font-size:28px; font-weight:800; color:#e41837; line-height:1;">${s.count}</span>
                                <span style="font-family: 'Inter', sans-serif; font-size:10px; color:#9ca3af; font-weight:600;">Nodes</span>
                            </div>
                            <div style="width: 20px; height: 3px; background: #e41837; margin-top: 12px; border-radius: 2px;"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        section.scrollIntoView({ behavior: 'smooth' });
    }
};



function initHolidayModule() {
    const yearFilter = document.getElementById('holiday-year-filter');
    const monthFilter = document.getElementById('holiday-month-filter');
    const entityTypeFilter = document.getElementById('holiday-entity-type-filter');
    const drawerEntityType = document.getElementById('holiday-drawer-entity-type');
    const drawerGeoLevel = document.getElementById('holiday-drawer-geo-level');
    const geoLevelFilter = document.getElementById('holiday-geography-level-filter');
    const geoFilter = document.getElementById('holiday-geography-filter');

    if (yearFilter) {
        const currentYear = new Date().getFullYear();
        for (let offset = -1; offset <= 2; offset++) {
            const year = currentYear + offset;
            yearFilter.insertAdjacentHTML('beforeend', `<option value="${year}">${year}</option>`);
        }
        yearFilter.value = holidayState.year;
    }
    if (monthFilter) {
        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        monthNames.forEach((name, idx) => {
            monthFilter.insertAdjacentHTML('beforeend', `<option value="${idx}">${name}</option>`);
        });
        monthFilter.value = holidayState.month;
    }
    [entityTypeFilter, drawerEntityType, document.getElementById('holiday-list-entity-filter')].forEach(select => {
        if (!select) return;
        select.innerHTML = `${select.id === 'holiday-list-entity-filter' ? '<option value="">All</option>' : ''}${HOLIDAY_ENTITY_TYPES.map(type => `<option value="${type}">${type}</option>`).join('')}`;
        if (select === entityTypeFilter) select.value = holidayState.entityType;
    });
    if (drawerEntityType) drawerEntityType.value = holidayState.entityType;
    if (drawerGeoLevel) drawerGeoLevel.value = holidayState.drawer.selectedLevel;
    refreshHolidayGeographyOptions();

    if (entityTypeFilter) entityTypeFilter.onchange = () => {
        holidayState.entityType = entityTypeFilter.value;
        if (drawerEntityType) drawerEntityType.value = holidayState.entityType;
        renderHolidayCalendar();
        renderHolidayList();
        refreshHolidayGeographyOptions();
    };
    if (yearFilter) yearFilter.onchange = () => { holidayState.year = parseInt(yearFilter.value, 10); renderHolidayCalendar(); };
    if (monthFilter) monthFilter.onchange = () => { holidayState.month = parseInt(monthFilter.value, 10); renderHolidayCalendar(); };
    if (document.getElementById('holiday-refresh-btn')) document.getElementById('holiday-refresh-btn').onclick = renderHolidayCalendar;
    if (document.getElementById('holiday-export-calendar-btn')) document.getElementById('holiday-export-calendar-btn').onclick = exportHolidayCalendar;
    if (document.getElementById('holiday-reset-filter-btn')) document.getElementById('holiday-reset-filter-btn').onclick = resetHolidayListFilters;
    if (document.getElementById('holiday-export-list-btn')) document.getElementById('holiday-export-list-btn').onclick = exportHolidayList;
    if (document.getElementById('holiday-prev-page-btn')) document.getElementById('holiday-prev-page-btn').onclick = () => { if (holidayState.listPage > 1) { holidayState.listPage -= 1; renderHolidayList(); } };
    if (document.getElementById('holiday-next-page-btn')) document.getElementById('holiday-next-page-btn').onclick = () => { holidayState.listPage += 1; renderHolidayList(); };
    if (geoLevelFilter) geoLevelFilter.onchange = refreshHolidayGeographyOptions;
    if (geoFilter) geoFilter.onchange = () => { holidayState.filters.geography = geoFilter.value; renderHolidayList(); };
    if (document.getElementById('holiday-type-filter')) document.getElementById('holiday-type-filter').onchange = () => { holidayState.filters.holidayType = document.getElementById('holiday-type-filter').value; renderHolidayList(); };
    if (document.getElementById('holiday-status-filter')) document.getElementById('holiday-status-filter').onchange = () => { holidayState.filters.status = document.getElementById('holiday-status-filter').value; renderHolidayList(); };
    if (document.getElementById('holiday-search-filter')) document.getElementById('holiday-search-filter').oninput = (e) => { holidayState.filters.search = e.target.value; renderHolidayList(); };

    if (document.getElementById('holiday-go-to-list-btn')) document.getElementById('holiday-go-to-list-btn').onclick = () => { renderHolidayList(); showPage('holiday-list-page'); };
    if (document.getElementById('holiday-go-to-upload-btn')) document.getElementById('holiday-go-to-upload-btn').onclick = () => { showPage('holiday-upload-page'); };
    if (document.getElementById('holiday-calendar-tab-btn')) document.getElementById('holiday-calendar-tab-btn').onclick = () => { renderHolidayCalendar(); showPage('holiday-calendar-page'); };
    if (document.getElementById('holiday-upload-tab-btn')) document.getElementById('holiday-upload-tab-btn').onclick = () => { showPage('holiday-upload-page'); };
    if (document.getElementById('holiday-calendar-tab-btn-2')) document.getElementById('holiday-calendar-tab-btn-2').onclick = () => { renderHolidayCalendar(); showPage('holiday-calendar-page'); };
    if (document.getElementById('holiday-list-tab-btn-2')) document.getElementById('holiday-list-tab-btn-2').onclick = () => { renderHolidayList(); showPage('holiday-list-page'); };
    if (document.getElementById('holiday-download-template-btn')) document.getElementById('holiday-download-template-btn').onclick = downloadHolidayTemplate;
    if (document.getElementById('holiday-upload-file-input')) document.getElementById('holiday-upload-file-input').onchange = (e) => { handleHolidayUploadFile(e.target.files[0]); };
    if (document.getElementById('holiday-import-btn')) document.getElementById('holiday-import-btn').onclick = processHolidayUpload;
    if (document.getElementById('holiday-download-error-report-btn')) document.getElementById('holiday-download-error-report-btn').onclick = downloadHolidayErrorReport;
    if (drawerGeoLevel) drawerGeoLevel.onchange = populateDrawerGeographies;
    if (document.getElementById('holiday-drawer-close-btn')) document.getElementById('holiday-drawer-close-btn').onclick = closeHolidayDrawer;
    if (document.getElementById('holiday-drawer-backdrop')) document.getElementById('holiday-drawer-backdrop').onclick = closeHolidayDrawer;
    if (document.getElementById('holiday-drawer-cancel-btn')) document.getElementById('holiday-drawer-cancel-btn').onclick = closeHolidayDrawer;
    if (document.getElementById('holiday-drawer-save-btn')) document.getElementById('holiday-drawer-save-btn').onclick = saveHolidayFromDrawer;
}

function refreshHolidayGeographyOptions() {
    const geoLevel = document.getElementById('holiday-geography-level-filter')?.value || '';
    const geoFilter = document.getElementById('holiday-geography-filter');
    const options = getHolidayGeographyOptions(geoLevel);
    if (!geoFilter) return;
    geoFilter.innerHTML = '<option value="">All</option>' + options.map(value => `<option value="${value}">${value}</option>`).join('');
}

function getHolidayGeographyOptions(level) {
    const sourceMap = {
        Region: data.regions || [],
        Circle: data.circles || [],
        Cluster: data.clusters || [],
        Branch: data.branches || []
    };
    const source = sourceMap[level] || [];
    return source.map(item => item.name || item.id || item).slice(0, 50);
}

function initHolidayFilters() {
    const yearFilter = document.getElementById('holiday-year-filter');
    const monthFilter = document.getElementById('holiday-month-filter');
    if (yearFilter) yearFilter.value = holidayState.year;
    if (monthFilter) monthFilter.value = holidayState.month;
    if (document.getElementById('holiday-entity-type-filter')) document.getElementById('holiday-entity-type-filter').value = holidayState.entityType;
    refreshHolidayGeographyOptions();
}

function renderHolidayCalendar() {
    const title = document.getElementById('holiday-calendar-title');
    const grid = document.getElementById('holiday-calendar-grid');
    if (!grid || !title) return;
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    title.textContent = `${monthNames[holidayState.month]} ${holidayState.year}`;
    grid.innerHTML = '';
    const firstOfMonth = new Date(holidayState.year, holidayState.month, 1);
    const startDay = firstOfMonth.getDay();
    const daysInMonth = new Date(holidayState.year, holidayState.month + 1, 0).getDate();
    const weekdayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    weekdayNames.forEach(name => {
        const header = document.createElement('div');
        header.style.fontWeight = '700';
        header.style.color = '#475569';
        header.style.padding = '12px 0 6px';
        header.textContent = name;
        grid.appendChild(header);
    });
    for (let i = 0; i < startDay; i++) {
        const placeholder = document.createElement('div');
        placeholder.style.minHeight = '92px';
        placeholder.style.background = 'transparent';
        placeholder.style.border = 'none';
        grid.appendChild(placeholder);
    }
    const selectedDate = holidayState.drawer.visible ? holidayState.drawer.date : null;
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(holidayState.year, holidayState.month, day);
        const status = getHolidayStatusForDate(date);
        const dateKey = formatDate(date);
        const selectedClass = selectedDate === dateKey ? ' selected' : '';
        const card = document.createElement('div');
        // Add the holiday type directly as a class on the card so the entire tile can be styled
        const typeClass = status.indicator ? status.indicator : '';
        card.className = `holiday-day-card ${status.cardClass} ${typeClass}${selectedClass}`.trim();
        card.dataset.date = dateKey;
        card.innerHTML = `
            <div class="day-number">${day}</div>
            <div class="day-label">${weekdayNames[date.getDay()]}</div>
            ${status.tag ? `<div class="holiday-tag">${status.tag}</div>` : ''}
        `;
        card.onclick = () => openHolidayDrawer(date, status);
        grid.appendChild(card);
    }
}

function getHolidayStatusForDate(date) {
    const dateKey = formatDate(date);
    const isSunday = date.getDay() === 0;
    const isSaturday = date.getDay() === 6;
    const thirdSaturday = isSaturday && Math.ceil(date.getDate() / 7) === 3;
    const record = holidayState.records.find(r => r.date === dateKey && r.entityType === holidayState.entityType);
    if (record) {
        let cardClass = 'holiday-day';
        let tag = record.holidayType || 'Configured Holiday';
        let indicator = record.holidayType === 'Configured Working Weekend'
            ? 'working-weekend'
            : record.holidayType === 'Special Closure'
                ? 'special'
                : record.holidayType === 'Holiday Overridden'
                    ? 'overridden'
                    : 'configured';
        if (record.workingStatus && record.workingStatus.toLowerCase().includes('working')) {
            cardClass = 'working-day';
        }
        return { cardClass, tag, indicator, isDefaultWeekend: false, record, isHoliday: record.workingStatus !== 'Working Day' };
    }
    if (isSunday) {
        return { cardClass: 'holiday-day', tag: 'Holiday', indicator: '', isDefaultWeekend: true, isHoliday: true };
    }
    if (isSaturday) {
        if (thirdSaturday) {
            return { cardClass: 'working-day', tag: '', indicator: '', isDefaultWeekend: true, isHoliday: false };
        }
        return { cardClass: 'holiday-day', tag: 'Holiday', indicator: '', isDefaultWeekend: true, isHoliday: true };
    }
    return { cardClass: 'working-day', tag: '', indicator: '', isDefaultWeekend: false, isHoliday: false };
}

function openHolidayDrawer(date, status, options = {}) {
    const drawer = document.getElementById('holiday-drawer');
    const drawerWrapper = document.getElementById('holiday-form-container');
    if (!drawer) return;
    const overlay = options.overlay === true;
    if (overlay) {
        drawer.classList.add('overlay-mode');
        if (drawerWrapper) {
            drawerWrapper.classList.add('overlay-open');
            drawerWrapper.style.display = 'block';
        }
    } else {
        drawer.classList.remove('overlay-mode');
        if (drawerWrapper) {
            drawerWrapper.classList.remove('overlay-open');
            drawerWrapper.style.display = '';
        }
    }

    holidayState.drawer.visible = true;
    holidayState.drawer.date = formatDate(date);
    const title = document.getElementById('holiday-drawer-title');
    const dateLabel = document.getElementById('holiday-drawer-date');
    const saveBtn = document.getElementById('holiday-drawer-save-btn');
    const drawerEntityType = document.getElementById('holiday-drawer-entity-type');
    const drawerLevel = document.getElementById('holiday-drawer-geo-level');
    const nameInput = document.getElementById('holiday-name-input');
    const remarksInput = document.getElementById('holiday-remarks');
    const existingCard = document.getElementById('holiday-existing-holiday-card');
    const geoSearch = document.getElementById('holiday-geo-search');

    const setDrawerEditable = (enabled) => {
        if (nameInput) nameInput.disabled = !enabled;
        if (drawerEntityType) drawerEntityType.disabled = !enabled;
        if (drawerLevel) drawerLevel.disabled = !enabled;
        if (remarksInput) remarksInput.disabled = !enabled;
        if (geoSearch) geoSearch.disabled = !enabled;
        const checkboxList = document.querySelectorAll('#custom-geo-checkbox-list input[type="checkbox"]');
        checkboxList.forEach(cb => cb.disabled = !enabled);
    };

    if (drawerEntityType) drawerEntityType.value = status.record?.entityType || holidayState.entityType;
    if (drawerLevel) drawerLevel.value = status.record?.geographyLevel || holidayState.drawer.selectedLevel || 'Region';
    populateDrawerGeographies();
    if (status.record) {
        syncGeoCheckboxes(status.record.geography.split(',').map(v => v.trim()).filter(Boolean));
    }

    const isView = status.mode === 'view';
    const isEdit = status.mode === 'edit';

    if (isView && status.record) {
        if (title) title.textContent = 'Holiday Details';
        holidayState.drawer.mode = 'view';
        if (saveBtn) saveBtn.style.display = 'none';
        if (existingCard) {
            existingCard.style.display = 'none';
            existingCard.innerHTML = '';
        }
    } else if (isEdit && status.record) {
        if (title) title.textContent = 'Edit Holiday';
        holidayState.drawer.mode = 'edit';
        holidayState.drawer.defaultStatus = status.record.workingStatus !== 'Working Day' ? 'Holiday' : 'Working Day';
        if (saveBtn) {
            saveBtn.textContent = 'Update Holiday';
            saveBtn.style.display = '';
        }
        if (existingCard) {
            existingCard.style.display = 'none';
            existingCard.innerHTML = '';
        }
    } else if (status.record) {
        if (title) title.textContent = 'Create Holiday';
        holidayState.drawer.mode = 'create';
        holidayState.drawer.defaultStatus = status.record.workingStatus !== 'Working Day' ? 'Holiday' : 'Working Day';
        if (saveBtn) {
            saveBtn.textContent = 'Create Holiday';
            saveBtn.style.display = '';
        }
        if (existingCard) {
            existingCard.style.display = 'block';
            existingCard.innerHTML = `
                <div class="existing-holiday-heading">Existing Holiday</div>
                <div class="existing-holiday-ticket compact">
                    <div class="ticket-title">${status.record.name}</div>
                    <div class="ticket-actions">
                        <button class="icon-btn ticket-action-btn" type="button" onclick="editHoliday('${status.record.id}')" aria-label="Edit holiday">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                            </svg>
                        </button>
                        <button class="icon-btn ticket-action-btn delete" type="button" onclick="deleteHoliday('${status.record.id}')" aria-label="Delete holiday">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6l-2 14H7L5 6"></path>
                                <path d="M10 11v6"></path>
                                <path d="M14 11v6"></path>
                                <path d="M9 6V4h6v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }
    } else if (status.isDefaultWeekend && !status.record && status.isHoliday) {
        if (title) title.textContent = 'Override Holiday Configuration';
        holidayState.drawer.mode = 'override';
        holidayState.drawer.defaultStatus = status.isHoliday ? 'Holiday' : 'Working Day';
        if (saveBtn) {
            saveBtn.textContent = 'Save Override';
            saveBtn.style.display = '';
        }
        if (existingCard) {
            existingCard.style.display = 'none';
            existingCard.innerHTML = '';
        }
    } else {
        if (title) title.textContent = 'Create Holiday';
        holidayState.drawer.mode = 'create';
        holidayState.drawer.defaultStatus = 'Holiday';
        if (saveBtn) {
            saveBtn.textContent = 'Create Holiday';
            saveBtn.style.display = '';
        }
        if (existingCard) {
            existingCard.style.display = 'none';
            existingCard.innerHTML = '';
        }
    }

    if (dateLabel) dateLabel.textContent = `${status.isHoliday ? 'Holiday' : 'Working Day'} · ${holidayState.drawer.date}`;
    if (nameInput) nameInput.value = status.record?.name || '';
    if (remarksInput) remarksInput.value = status.record?.remarks || '';
    if (drawerEntityType && status.record) drawerEntityType.value = status.record.entityType || holidayState.entityType;

    if (holidayState.drawer.mode === 'override') {
        if (nameInput) nameInput.closest('.form-group').style.display = 'none';
    } else {
        if (nameInput) nameInput.closest('.form-group').style.display = '';
    }

    setDrawerEditable(!isView);

    if (!overlay) {
        const body = document.querySelector('.holiday-calendar-body');
        if (body) body.classList.add('split-view');
        const calendarPanel = document.querySelector('.holiday-calendar-panel');
        if (calendarPanel) calendarPanel.classList.add('drawer-open');
    }

    drawer.style.display = 'block';
    const previousSelected = document.querySelector('.holiday-day-card.selected');
    if (previousSelected) previousSelected.classList.remove('selected');
    const selectedCard = document.querySelector(`.holiday-day-card[data-date="${holidayState.drawer.date}"]`);
    if (selectedCard) selectedCard.classList.add('selected');
}

function closeHolidayDrawer() {
    const drawer = document.getElementById('holiday-drawer');
    if (!drawer) return;
    drawer.style.display = 'none';
    drawer.classList.remove('overlay-mode');
    const drawerWrapper = document.getElementById('holiday-form-container');
    if (drawerWrapper) {
        drawerWrapper.classList.remove('overlay-open');
        drawerWrapper.style.display = '';
    }
    holidayState.drawer.visible = false;
    holidayState.drawer.date = null;

    // Collapse split-view so the calendar occupies 100% width
    const body = document.querySelector('.holiday-calendar-body');
    if (body) body.classList.remove('split-view');

    const calendarPanel = document.querySelector('.holiday-calendar-panel');
    if (calendarPanel) calendarPanel.classList.remove('drawer-open');
    renderHolidayCalendar();
}

function populateDrawerGeographies() {
    const level = document.getElementById('holiday-drawer-geo-level')?.value || 'Region';
    holidayState.drawer.selectedLevel = level;

    // Populate hidden native select (kept for downstream data reads)
    const dropdown = document.getElementById('holiday-drawer-geo-values');
    if (!dropdown) return;
    const options = getHolidayGeographyOptions(level);
    dropdown.innerHTML = options.map(item => `<option value="${item}">${item}</option>`).join('');

    // Render custom checkbox list
    const listEl = document.getElementById('custom-geo-checkbox-list');
    if (!listEl) return;

    const selectAllId = 'geo-chk-select-all';
    listEl.innerHTML = '';

    // "Select All" row
    const allRow = document.createElement('label');
    allRow.className = 'geo-checkbox-item select-all-row';
    allRow.htmlFor = selectAllId;
    const allChk = document.createElement('input');
    allChk.type = 'checkbox';
    allChk.id = selectAllId;
    allRow.appendChild(allChk);
    allRow.appendChild(document.createTextNode('Select All'));
    listEl.appendChild(allRow);

    // Individual option rows
    options.forEach(item => {
        const id = `geo-chk-${item.replace(/\s+/g, '-')}`;
        const row = document.createElement('label');
        row.className = 'geo-checkbox-item';
        row.htmlFor = id;
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = id;
        chk.value = item;
        chk.addEventListener('change', () => {
            // Sync checked state to hidden native select
            Array.from(dropdown.options).forEach(opt => {
                opt.selected = document.querySelector(`#custom-geo-checkbox-list input[value="${opt.value}"]`)?.checked || false;
            });
            // Update Select All checkbox state
            const all = listEl.querySelectorAll('input[type="checkbox"]:not(#' + selectAllId + ')');
            allChk.checked = all.length > 0 && Array.from(all).every(c => c.checked);
            allChk.indeterminate = !allChk.checked && Array.from(all).some(c => c.checked);
        });
        row.appendChild(chk);
        row.appendChild(document.createTextNode(item));
        listEl.appendChild(row);
    });

    // Wire Select All (only apply to visible items)
    allChk.addEventListener('change', () => {
        listEl.querySelectorAll('input[type="checkbox"]:not(#' + selectAllId + ')').forEach(c => {
            const row = c.closest('.geo-checkbox-item');
            if (row && row.style.display === 'none') return; // skip hidden by search
            c.checked = allChk.checked;
        });
        Array.from(dropdown.options).forEach(opt => {
            const chk = listEl.querySelector(`input[value="${opt.value}"]`);
            opt.selected = chk ? chk.checked : opt.selected;
        });
    });

    // Wire search input to filter the checkbox list
    const searchInput = document.getElementById('custom-geo-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = () => {
            const q = String(searchInput.value || '').trim().toLowerCase();
            const rows = Array.from(listEl.querySelectorAll('.geo-checkbox-item'));
            rows.forEach(row => {
                if (row.classList.contains('select-all-row')) return;
                const txt = row.textContent.trim().toLowerCase();
                row.style.display = q === '' || txt.includes(q) ? '' : 'none';
            });
            // Update select-all checkbox state based on visible items
            const visibleChecks = Array.from(listEl.querySelectorAll('input[type="checkbox"]:not(#' + selectAllId + ')')).filter(c => c.closest('.geo-checkbox-item')?.style.display !== 'none');
            const allVisibleChecked = visibleChecks.length > 0 && visibleChecks.every(c => c.checked);
            allChk.checked = allVisibleChecked;
            allChk.indeterminate = !allVisibleChecked && visibleChecks.some(c => c.checked);
        };
    }
}

// Pre-tick checkboxes for a given array of selected geography values
function syncGeoCheckboxes(selectedValues) {
    const listEl = document.getElementById('custom-geo-checkbox-list');
    const selectAllId = 'geo-chk-select-all';
    if (!listEl) return;
    const all = listEl.querySelectorAll('input[type="checkbox"]:not(#' + selectAllId + ')');
    all.forEach(chk => {
        chk.checked = selectedValues.includes(chk.value);
    });
    const allChk = document.getElementById(selectAllId);
    if (allChk) {
        allChk.checked = all.length > 0 && Array.from(all).every(c => c.checked);
        allChk.indeterminate = !allChk.checked && Array.from(all).some(c => c.checked);
    }
    // Keep hidden select in sync
    const dropdown = document.getElementById('holiday-drawer-geo-values');
    if (dropdown) {
        Array.from(dropdown.options).forEach(opt => { opt.selected = selectedValues.includes(opt.value); });
    }
}

function saveHolidayFromDrawer() {
    const nameInput = document.getElementById('holiday-name-input');
    const entityType = document.getElementById('holiday-drawer-entity-type')?.value || holidayState.entityType;
    const level = document.getElementById('holiday-drawer-geo-level')?.value || 'Region';
    const selectedOptions = Array.from(document.getElementById('holiday-drawer-geo-values')?.selectedOptions || []).map(o => o.value);
    const remarks = document.getElementById('holiday-remarks')?.value || '';
    let name = nameInput?.value?.trim();
    
    if (holidayState.drawer.mode === 'view') {
        closeHolidayDrawer();
        return;
    }

    if (!name) {
        if (holidayState.drawer.mode === 'override') {
            name = holidayState.drawer.defaultStatus === 'Holiday' ? 'Weekend Override' : 'Weekend Working Override';
        } else {
            return showCustomModal({
                title: 'Validation error',
                message: 'Please enter a holiday name.',
                type: 'info',
                confirmText: 'Close'
            });
        }
    }
    if (selectedOptions.length === 0) {
        return showCustomModal({
            title: 'Validation error',
            message: 'Please select at least one applicable geography.',
            type: 'info',
            confirmText: 'Close'
        });
    }
    const date = holidayState.drawer.date;
    const isHoliday = holidayState.drawer.defaultStatus === 'Holiday';
    const holidayType = holidayState.drawer.mode === 'override'
        ? 'Holiday Overridden'
        : (isHoliday ? 'Configured Holiday' : 'Configured Working Weekend');
    const workingStatus = isHoliday ? 'Holiday' : 'Working Day';

    // For edit mode, find and update the existing record
    if (holidayState.drawer.mode === 'edit') {
        const editingRecord = holidayState.records.find(r => r.date === date);
        if (editingRecord) {
            editingRecord.name = name;
            editingRecord.geographyLevel = level;
            editingRecord.geography = selectedOptions.join(', ');
            editingRecord.remarks = remarks;
            editingRecord.workingStatus = workingStatus;
            editingRecord.holidayType = holidayType;
            closeHolidayDrawer();
            renderHolidayCalendar();
            renderHolidayList();
            showCustomModal({
                title: 'Holiday updated',
                message: 'Holiday has been updated successfully.',
                type: 'info',
                confirmText: 'Close'
            });
            return;
        }
    }

    // For create and override modes, create new record
    const record = {
        id: `hl-${Date.now()}`,
        name,
        date,
        day: new Date(date).toLocaleDateString('en-US', { weekday: 'long' }),
        holidayType,
        entityType,
        geographyLevel: level,
        geography: selectedOptions.join(', '),
        workingStatus,
        remarks,
        createdBy: 'Admin',
        createdDate: new Date().toLocaleDateString('en-GB'),
        status: 'Active'
    };
    const existingIndex = holidayState.records.findIndex(r => r.date === date && r.entityType === entityType && r.geographyLevel === level && r.geography === record.geography);
    if (existingIndex >= 0) {
        holidayState.records[existingIndex] = record;
    } else {
        holidayState.records.push(record);
    }
    closeHolidayDrawer();
    renderHolidayCalendar();
    renderHolidayList();
    
    // Show different success message for override vs create
    const isOverride = holidayState.drawer.mode === 'override';
    showCustomModal({
        title: isOverride ? 'Holiday Overridden' : 'Holiday saved',
        message: isOverride ? 'Holiday overridden successfully.' : 'Holiday saved successfully.',
        type: 'info',
        confirmText: 'Close'
    });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildSectionRow(title, description) {
    return `
        <tr class="holiday-list-section-row">
            <td colspan="12">
                <div class="holiday-list-section-title">
                    <strong>${escapeHtml(title)}</strong>
                    ${description ? `<span>${escapeHtml(description)}</span>` : ''}
                </div>
            </td>
        </tr>`;
}

function buildEmptyRow(message) {
    return `
        <tr class="holiday-list-empty-row">
            <td colspan="12">${escapeHtml(message)}</td>
        </tr>`;
}

function formatGeographyCell(record) {
    const geography = String(record.geography || 'All Geographies');
    const maxLength = 30;
    const full = escapeHtml(geography);
    const preview = geography.length <= maxLength ? full : escapeHtml(geography.slice(0, maxLength - 3) + '...');
    return `
        <div class="holiday-geo-cell">
            <span class="holiday-geo-text" title="${full}">${preview}</span>
            <button type="button" class="action-btn holiday-geo-view-more" title="View more geography" onclick="showGeographyPopup('${record.id}')">View More</button>
        </div>`;
}

function buildHolidayRecordRow(record) {
    const geographyCell = formatGeographyCell(record);
    const actions = record.isWeekend ? `
        <button type="button" class="cet-icon-btn view" title="Override weekend holiday" onclick="overrideWeekendHolidayFromList('${record.date}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
            </svg>
        </button>` : `
        <button type="button" class="cet-icon-btn update" title="Edit holiday" onclick="editHoliday('${record.id}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
            </svg>
        </button>
        <button type="button" class="cet-icon-btn delete" title="Delete holiday" onclick="deleteHoliday('${record.id}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6l-2 14H7L5 6"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
                <path d="M9 6V4h6v2"></path>
            </svg>
        </button>`;

    return `
        <tr>
            <td>${escapeHtml(record.name)}</td>
            <td>${escapeHtml(record.date)}</td>
            <td>${escapeHtml(record.day)}</td>
            <td>${escapeHtml(record.holidayType)}</td>
            <td>${escapeHtml(record.entityType)}</td>
            <td>${escapeHtml(record.geographyLevel)}</td>
            <td>${geographyCell}</td>
            <td>${escapeHtml(record.remarks)}</td>
            <td>${escapeHtml(record.createdBy)}</td>
            <td>${escapeHtml(record.createdDate)}</td>
            <td class="holiday-actions-cell">${actions}</td>
        </tr>`;
}

function getWeekendHolidayRows() {
    const weekendRows = [];
    const year = holidayState.year;
    const month = holidayState.month;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const weekday = date.getDay();
        if (weekday !== 0 && weekday !== 6) continue;

        const dateKey = formatDate(date);
        const alreadyConfigured = holidayState.records.some(record => record.date === dateKey);
        if (alreadyConfigured) continue;

        weekendRows.push({
            id: `${dateKey}-weekend`,
            name: 'Weekend Holiday',
            date: dateKey,
            day: date.toLocaleDateString('en-US', { weekday: 'long' }),
            holidayType: 'Weekend Holiday',
            entityType: 'All Entities',
            geographyLevel: 'All',
            geography: 'All Geographies',
            workingStatus: 'Holiday',
            remarks: 'Default weekend holiday',
            createdBy: 'System',
            createdDate: '-',
            isWeekend: true,
        });
    }
    return weekendRows;
}

function openHolidayDrawerByDate(dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return showCustomModal({
            title: 'Invalid Date',
            message: 'Invalid date selected.',
            type: 'info',
            confirmText: 'Close'
        });
    }
    openHolidayDrawer(date, getHolidayStatusForDate(date), { overlay: true });
}

function overrideWeekendHolidayFromList(dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return showCustomModal({
            title: 'Invalid Date',
            message: 'Invalid date selected.',
            type: 'info',
            confirmText: 'Close'
        });
    }

    // Navigate to calendar page
    const listPage = document.getElementById('holiday-list-page');
    const calendarPage = document.getElementById('holiday-calendar-page');
    if (listPage) listPage.style.display = 'none';
    if (calendarPage) calendarPage.style.display = 'block';

    // Update year/month to match the date
    holidayState.year = date.getFullYear();
    holidayState.month = date.getMonth();

    // Open drawer in override mode
    const status = getHolidayStatusForDate(date);
    openHolidayDrawer(date, status, { overlay: false });

    // Render calendar
    renderHolidayCalendar();

    // Highlight the date
    const previousSelected = document.querySelector('.holiday-day-card.selected');
    if (previousSelected) previousSelected.classList.remove('selected');
    const selectedCard = document.querySelector(`.holiday-day-card[data-date="${dateString}"]`);
    if (selectedCard) selectedCard.classList.add('selected');
}

function showGeographyPopup(recordId) {
    const record = holidayState.records.find(r => r.id === recordId);
    if (!record) return;

    const geography = String(record.geography || 'All Geographies');
    const items = geography.split(',').map(item => item.trim()).filter(Boolean);
    const listHtml = items.length ? items.map(item => `<div class="holiday-geo-full-item">${escapeHtml(item)}</div>`).join('') : `<div class="holiday-geo-full-item">All Geographies</div>`;

    const modalContent = `
        <div class="holiday-geo-full-list">
            <input id="geography-search-input" class="holiday-list-search" type="text" placeholder="Search geography..." />
            <div id="geography-list-container">${listHtml}</div>
        </div>`;

    showCustomModal({
        title: 'Geography details',
        message: modalContent,
        confirmText: 'Close',
        type: 'info',
        isHtml: true,
        onOpen: () => {
            const searchInput = document.getElementById('geography-search-input');
            const listContainer = document.getElementById('geography-list-container');
            if (!searchInput || !listContainer) return;

            searchInput.addEventListener('input', () => {
                const filter = searchInput.value.trim().toLowerCase();
                Array.from(listContainer.children).forEach(item => {
                    item.style.display = !filter || item.textContent.toLowerCase().includes(filter) ? 'block' : 'none';
                });
            });
        }
    });
}

function renderHolidayList() {
    const tbody = document.getElementById('holiday-list-body');
    if (!tbody) return;

    const hasActiveFilters = holidayState.filters.entityType || holidayState.filters.geographyLevel || holidayState.filters.geography || holidayState.filters.holidayType || holidayState.filters.search;
    
    if (!hasActiveFilters) {
        tbody.innerHTML = buildEmptyRow('Select filters to display holidays.');
        const pageIndicator = document.getElementById('holiday-list-page-indicator');
        if (pageIndicator) pageIndicator.textContent = 'No filters selected';
        return;
    }

    const filterType = holidayState.filters.holidayType;
    const allRecords = filterHolidayRecords();
    const weekendRecords = getWeekendHolidayRows();
    
    const rows = [];
    let displayRecords = [];
    let displayCount = 0;

    if (!filterType) {
        // If no specific type filter, show Weekend, then Configured, then Override
        displayRecords = [...weekendRecords, ...allRecords];
        displayCount = weekendRecords.length + allRecords.length;
    } else if (filterType === 'Weekend Holiday') {
        displayRecords = weekendRecords;
        displayCount = weekendRecords.length;
    } else if (filterType === 'Configured Holiday') {
        // Show only Configured Holiday type (not Working Weekend overrides)
        displayRecords = allRecords.filter(r => r.holidayType === 'Configured Holiday');
        displayCount = displayRecords.length;
    } else if (filterType === 'Override Holiday') {
        // Show only Holiday Overridden type
        displayRecords = allRecords.filter(r => r.holidayType === 'Holiday Overridden');
        displayCount = displayRecords.length;
    }

    if (displayRecords.length > 0) {
        rows.push(...displayRecords.map(buildHolidayRecordRow));
    } else {
        rows.push(buildEmptyRow('No holidays match the current filters.'));
    }

    tbody.innerHTML = rows.join('');

    const pageIndicator = document.getElementById('holiday-list-page-indicator');
    if (pageIndicator) {
        pageIndicator.textContent = filterType ? `${filterType} (${displayCount} records)` : `Showing ${displayCount} records`;
    }

    const prevBtn = document.getElementById('holiday-prev-page-btn');
    const nextBtn = document.getElementById('holiday-next-page-btn');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
}

function filterHolidayRecords() {
    return holidayState.records.filter(record => {
        if (holidayState.filters.entityType && record.entityType !== holidayState.filters.entityType) return false;
        if (holidayState.filters.geographyLevel && record.geographyLevel !== holidayState.filters.geographyLevel) return false;
        if (holidayState.filters.geography && !record.geography.includes(holidayState.filters.geography)) return false;
        if (holidayState.filters.holidayType) {
            const desiredType = holidayState.filters.holidayType === 'Override Holiday'
                ? 'Holiday Overridden'
                : holidayState.filters.holidayType;
            if (record.holidayType !== desiredType) return false;
        }
        if (holidayState.filters.status !== 'All' && record.status !== holidayState.filters.status) return false;
        if (holidayState.filters.search) {
            const term = holidayState.filters.search.toLowerCase();
            const haystack = `${record.name} ${record.geography} ${record.holidayType} ${record.remarks}`.toLowerCase();
            return haystack.includes(term);
        }
        return true;
    });
}

function resetHolidayListFilters() {
    holidayState.filters = { entityType:'', geographyLevel:'', geography:'', holidayType:'', status:'All', search:'' };
    const ids = ['holiday-list-entity-filter', 'holiday-geography-level-filter', 'holiday-geography-filter', 'holiday-type-filter', 'holiday-status-filter', 'holiday-search-filter'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) { el.value = id === 'holiday-status-filter' ? 'All' : ''; } });
    refreshHolidayGeographyOptions();
    renderHolidayList();
}

function viewHoliday(id) {
    console.log('viewHoliday called with id:', id);
    const record = holidayState.records.find(r => r.id === id);
    if (!record) {
        console.warn('Record not found for id:', id);
        return showCustomModal({
            title: 'Holiday not found',
            message: 'Holiday record not found.',
            type: 'info',
            confirmText: 'Close'
        });
    }

    const date = new Date(record.date);
    if (isNaN(date.getTime())) return showCustomModal({
        title: 'Invalid Date',
        message: 'Cannot open holiday details for an invalid date.',
        type: 'info',
        confirmText: 'Close'
    });

    console.log('Opening drawer for view, record:', record);
    openHolidayDrawer(date, { record, mode: 'view', isHoliday: record.workingStatus !== 'Working Day' }, { overlay: true });
}

function editHoliday(id) {
    console.log('editHoliday called with id:', id);
    const record = holidayState.records.find(r => r.id === id);
    if (!record) {
        console.warn('Record not found for id:', id);
        return showCustomModal({
            title: 'Holiday not found',
            message: 'Holiday record not found.',
            type: 'info',
            confirmText: 'Close'
        });
    }

    const date = new Date(record.date);
    if (isNaN(date.getTime())) return showCustomModal({
        title: 'Invalid Date',
        message: 'Cannot edit holiday for an invalid date.',
        type: 'info',
        confirmText: 'Close'
    });

    // Navigate to calendar page
    const listPage = document.getElementById('holiday-list-page');
    const calendarPage = document.getElementById('holiday-calendar-page');
    if (listPage) listPage.style.display = 'none';
    if (calendarPage) calendarPage.style.display = 'block';

    // Update year/month to match the record date
    const recordDate = new Date(record.date);
    holidayState.year = recordDate.getFullYear();
    holidayState.month = recordDate.getMonth();

    console.log('Opening drawer for edit, record:', record);
    openHolidayDrawer(date, { record, mode: 'edit', isHoliday: record.workingStatus !== 'Working Day' }, { overlay: false });

    // Render calendar with the updated year/month
    renderHolidayCalendar();

    // Ensure the calendar grid date card shows selected state
    const previousSelected = document.querySelector('.holiday-day-card.selected');
    if (previousSelected) previousSelected.classList.remove('selected');
    const selectedCard = document.querySelector(`.holiday-day-card[data-date="${record.date}"]`);
    if (selectedCard) selectedCard.classList.add('selected');
}

async function deleteHoliday(id) {
    const record = holidayState.records.find(r => r.id === id);
    if (!record) {
        showCustomModal({ title: 'Error', message: 'Holiday record not found.', confirmText: 'Close' });
        return;
    }
    
    const confirmed = await showCustomModal({
        title: 'Delete Holiday',
        message: `Are you sure you want to delete "${record.name}" on ${record.date}? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        type: 'confirm'
    });
    
    if (!confirmed) return;
    
    holidayState.records = holidayState.records.filter(r => r.id !== id);
    renderHolidayList();
    renderHolidayCalendar();
    if (record && holidayState.drawer.visible && holidayState.drawer.date === record.date) {
        const date = new Date(record.date);
        if (!isNaN(date.getTime())) {
            openHolidayDrawer(date, getHolidayStatusForDate(date));
        }
    }
    
    showCustomModal({ title: 'Success', message: `Holiday "${record.name}" has been deleted successfully.`, confirmText: 'Close' });
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function downloadHolidayTemplate() {
    const headers = ['Holiday Name','Holiday Date','Holiday Type','Entity Type','Geography Level','Geography','Remarks'];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
    XLSX.writeFile(workbook, 'holiday-upload-template.xlsx');
}

function handleHolidayUploadFile(file) {
    if (!file) return;
    const fileNameEl = document.getElementById('holiday-upload-file-name');
    if (fileNameEl) {
        fileNameEl.textContent = `Selected: ${file.name}`;
        fileNameEl.style.display = 'block';
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataArray = new Uint8Array(e.target.result);
        const workbook = XLSX.read(dataArray, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1 });
        if (!sheetData || sheetData.length < 2) {
            return alert('The file does not contain valid holiday data.');
        }
        const headers = sheetData[0].map(h => String(h || '').trim());
        const rows = sheetData.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== null && String(cell).trim() !== ''));
        holidayState.uploadErrors = [];
        holidayState.uploadFile = { headers, rows };
        const instructions = document.getElementById('holiday-upload-instructions');
        if (instructions) instructions.textContent = `${rows.length} records ready for validation.`;
    };
    reader.readAsArrayBuffer(file);
}

function processHolidayUpload() {
    if (!holidayState.uploadFile || !holidayState.uploadFile.rows) {
        return alert('Please upload a file first.');
    }
    const { headers, rows } = holidayState.uploadFile;
    const required = ['Holiday Name','Holiday Date','Holiday Type','Entity Type','Geography Level','Geography'];
    const normalizedHeaders = headers.map(h => String(h).trim());
    const missing = required.filter(col => !normalizedHeaders.includes(col));
    if (missing.length) {
        return alert(`Missing required columns: ${missing.join(', ')}`);
    }
    const headerIndex = normalizedHeaders.reduce((map, header, idx) => ({ ...map, [header]: idx }), {});
    let success = 0;
    let failed = 0;
    const errors = [];
    rows.forEach((row, rowIndex) => {
        const rowData = {
            name: String(row[headerIndex['Holiday Name']] || '').trim(),
            date: String(row[headerIndex['Holiday Date']] || '').trim(),
            holidayType: String(row[headerIndex['Holiday Type']] || '').trim(),
            entityType: String(row[headerIndex['Entity Type']] || '').trim(),
            geographyLevel: String(row[headerIndex['Geography Level']] || '').trim(),
            geography: String(row[headerIndex['Geography']] || '').trim(),
            remarks: String(row[headerIndex['Remarks']] || '').trim()
        };
        const rowErrors = [];
        if (!rowData.name) rowErrors.push('Holiday Name is required');
        if (!rowData.date || isNaN(new Date(rowData.date).getTime())) rowErrors.push('Invalid Holiday Date');
        if (!HOLIDAY_ENTITY_TYPES.includes(rowData.entityType)) rowErrors.push('Invalid Entity Type');
        if (!HOLIDAY_GEO_LEVELS.includes(rowData.geographyLevel)) rowErrors.push('Invalid Geography Level');
        if (!rowData.geography) rowErrors.push('Geography is required');
        if (holidayState.records.some(r => r.date === rowData.date && r.entityType === rowData.entityType && r.geography === rowData.geography)) rowErrors.push('Duplicate holiday record');
        if (rowErrors.length) {
            failed += 1;
            errors.push({ row: rowIndex + 2, errors: rowErrors.join('; ') });
            return;
        }
        holidayState.records.push({
            id: `hol-${Date.now()}-${rowIndex}`,
            name: rowData.name,
            date: rowData.date,
            day: new Date(rowData.date).toLocaleDateString('en-US', { weekday: 'long' }),
            holidayType: rowData.holidayType || 'Configured Holiday',
            entityType: rowData.entityType,
            geographyLevel: rowData.geographyLevel,
            geography: rowData.geography,
            workingStatus: rowData.holidayType === 'Configured Working Weekend' ? 'Working Day' : 'Holiday',
            remarks: rowData.remarks,
            createdBy: 'Admin',
            createdDate: new Date().toLocaleDateString('en-GB'),
            status: 'Active'
        });
        success += 1;
    });
    holidayState.uploadErrors = errors;
    const total = document.getElementById('holiday-upload-total');
    const successEl = document.getElementById('holiday-upload-success');
    const failedEl = document.getElementById('holiday-upload-failed');
    const errorsEl = document.getElementById('holiday-upload-errors');
    if (total) total.textContent = rows.length;
    if (successEl) successEl.textContent = success;
    if (failedEl) failedEl.textContent = failed;
    if (errorsEl) errorsEl.textContent = errors.length ? errors.map(e => `Row ${e.row}: ${e.errors}`).join('\n') : 'No validation issues found.';
    const downloadBtn = document.getElementById('holiday-download-error-report-btn');
    if (downloadBtn) downloadBtn.disabled = errors.length === 0;
    renderHolidayCalendar();
    renderHolidayList();
}

function downloadHolidayErrorReport() {
    if (!holidayState.uploadErrors?.length) return;
    const lines = ['Row,Error'];
    holidayState.uploadErrors.forEach(err => lines.push(`${err.row},"${err.errors.replace(/"/g,'""')}"`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'holiday-upload-errors.csv';
    link.click();
}

function exportHolidayCalendar() {
    const workbook = XLSX.utils.book_new();
    const rows = [['Date','Day','Status','Holiday Name','Holiday Type','Entity Type','Geography Level','Geography']];
    const days = new Date(holidayState.year, holidayState.month + 1, 0).getDate();
    for (let day = 1; day <= days; day++) {
        const date = new Date(holidayState.year, holidayState.month, day);
        const status = getHolidayStatusForDate(date);
        rows.push([formatDate(date), date.toLocaleDateString('en-US', { weekday:'long' }), status.tag || (status.isHoliday ? 'Holiday' : 'Working Day'), status.record?.name || '', status.record?.holidayType || '', holidayState.entityType, status.record?.geographyLevel || '', status.record?.geography || '']);
    }
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Holiday Calendar');
    XLSX.writeFile(workbook, `holiday-calendar-${holidayState.year}-${holidayState.month + 1}.xlsx`);
}

function exportHolidayList() {
    const workbook = XLSX.utils.book_new();
    const records = filterHolidayRecords();
    const rows = [['Holiday Name','Holiday Date','Day','Holiday Type','Entity Type','Geography Level','Geography','Working Status','Remarks','Created By','Created Date','Status']];
    records.forEach(record => rows.push([record.name, record.date, record.day, record.holidayType, record.entityType, record.geographyLevel, record.geography, record.workingStatus, record.remarks, record.createdBy, record.createdDate, record.status]));
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Holiday List');
    XLSX.writeFile(workbook, `holiday-list-${new Date().toISOString().slice(0,10)}.xlsx`);
}




document.addEventListener('DOMContentLoaded', setup);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setup();
}
