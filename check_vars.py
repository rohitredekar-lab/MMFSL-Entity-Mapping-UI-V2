import json

with open('data.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Try to find systemUsers
start_idx = content.find('const systemUsers =')
if start_idx != -1:
    print("Found systemUsers")
    print(content[start_idx:start_idx+500])

start_idx_roles = content.find('"userRoles": [')
if start_idx_roles != -1:
    print("Found userRoles")
    print(content[start_idx_roles:start_idx_roles+500])
