import pandas as pd
import json
import math

def clean(val):
    if pd.isna(val) or str(val).strip().lower() == 'nan':
        return ""
    return str(val).strip()

def get_id(prefix, name):
    # Create a safe ID from name
    safe_name = "".join(c for c in name if c.isalnum())
    return f"{prefix}-{safe_name}"

try:
    df = pd.read_excel('data.xlsx')
    
    # Structures
    regions = {}
    states = {}
    circles = {}
    clusters = {}
    branches = {}
    
    region_to_state = set()
    state_to_circle = set()
    circle_to_cluster = set()
    cluster_to_branch = set()
    
    system_users_map = {} # sap -> {id, name, sap, dept, designations: set}
    user_roles_set = set() # (userId, role, entityId)
    
    def add_user(name, sap, role, entity_id, dept):
        name = clean(name)
        if pd.isna(sap):
            sap_str = ""
        else:
            try:
                sap_str = str(int(float(sap)))
            except:
                sap_str = str(sap).strip()
        
        if not name or not sap_str or sap_str.lower() == 'nan' or not entity_id:
            return
        
        if sap_str not in system_users_map:
            user_id = f"u-{sap_str}"
            system_users_map[sap_str] = {
                "id": user_id,
                "name": name,
                "empId": sap_str, 
                "department": dept,
                "designations": set()
            }
        
        system_users_map[sap_str]["designations"].add(role)
        user_roles_set.add((system_users_map[sap_str]["id"], role, entity_id))

    for _, row in df.iterrows():
        reg_name = clean(row.get('REGION', ''))
        st_name = clean(row.get('State', ''))
        cir_name = clean(row.get('Circle', ''))
        clu_name = clean(row.get('Cluster Name', ''))
        br_name = clean(row.get('Branch Name', ''))
        br_code = clean(row.get('Branch Code', ''))
        
        full_br_name = f"{br_name} ({br_code})" if br_code else br_name
        
        if not reg_name or not st_name or not cir_name or not clu_name or not br_name:
            continue

        reg_id = get_id('r', reg_name)
        st_id = get_id('s', st_name)
        cir_id = get_id('ci', cir_name)
        clu_id = get_id('cl', clu_name)
        br_id = get_id('b', f"{br_name}{br_code}")

        regions[reg_id] = {"id": reg_id, "name": reg_name, "type": "region"}
        states[st_id] = {"id": st_id, "name": st_name, "type": "state"}
        circles[cir_id] = {"id": cir_id, "name": cir_name, "type": "circle"}
        clusters[clu_id] = {"id": clu_id, "name": clu_name, "type": "cluster"}
        branches[br_id] = {"id": br_id, "name": full_br_name, "type": "branch"}

        region_to_state.add((reg_id, st_id))
        state_to_circle.add((st_id, cir_id))
        circle_to_cluster.add((cir_id, clu_id))
        cluster_to_branch.add((clu_id, br_id))

        # Users
        add_user(row.get('Cirlce Head Name'), row.get('Cirlce Head Sap Codes'), 'Circle Manager', cir_id, 'Circle Management')
        add_user(row.get('Cluster Manager'), row.get('Cluster Manager SAP Code'), 'Cluster Manager', clu_id, 'Cluster Management')
        add_user(row.get('Branch Manager Name'), row.get('Branch Manager SAP'), 'Branch Manager', br_id, 'Branch Management')
        add_user(row.get('Branch Operations Manager Name'), row.get('Branch Operations Manager SAP'), 'Branch Operations Manager', br_id, 'Branch Operations')
        add_user(row.get('Cashier Name'), row.get('Cashier SAP'), 'Cashier', br_id, 'Branch Operations')

    # Convert sets to lists for JSON
    users_list = []
    for u in system_users_map.values():
        u["designations"] = list(u["designations"])
        users_list.append(u)

    mappings = {
        "regionToState": [{"from": f, "to": t} for f, t in region_to_state],
        "stateToCircle": [{"from": f, "to": t} for f, t in state_to_circle],
        "circleToCluster": [{"from": f, "to": t} for f, t in circle_to_cluster],
        "clusterToBranch": [{"from": f, "to": t} for f, t in cluster_to_branch],
        "userRoles": [{"userId": u, "role": r, "entityId": e} for u, r, e in user_roles_set]
    }

    final_data = {
        "regions": list(regions.values()),
        "states": list(states.values()),
        "circles": list(circles.values()),
        "clusters": list(clusters.values()),
        "branches": list(branches.values()),
        "mappings": mappings
    }

    with open('data.js', 'w', encoding='utf-8') as f:
        f.write("const data = " + json.dumps(final_data, indent=4) + ";\n\n")
        f.write("const systemUsers = " + json.dumps(users_list, indent=4) + ";\n")

    print("data.js generated successfully.")

except Exception as e:
    import traceback
    print("Error:", str(e))
    traceback.print_exc()
