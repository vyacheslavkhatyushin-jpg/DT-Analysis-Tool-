from fastapi.testclient import TestClient


def test_requires_login(app_client: TestClient) -> None:
    assert app_client.get("/api/v1/sites").status_code == 401


def test_login_and_me(admin: TestClient) -> None:
    response = admin.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["role"] == "admin"


def test_wrong_password(app_client: TestClient, admin: TestClient) -> None:
    admin.post("/api/v1/auth/logout")
    response = app_client.post("/api/v1/auth/login", json={"username": "admin", "password": "nope"})
    assert response.status_code == 401


def test_bearer_token(app_client: TestClient, admin: TestClient) -> None:
    token = admin.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "password-123"}
    ).json()["access_token"]
    admin.cookies.clear()
    response = app_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_viewer_cannot_edit(viewer: TestClient) -> None:
    assert viewer.get("/api/v1/sites").status_code == 200
    response = viewer.post("/api/v1/sites", json={"code": "X", "lat": 1, "lon": 1})
    assert response.status_code == 403


def test_admin_manages_users(admin: TestClient) -> None:
    response = admin.post(
        "/api/v1/users", json={"username": "ivan", "password": "long-password", "role": "engineer"}
    )
    assert response.status_code == 201
    user_id = response.json()["id"]
    response = admin.patch(f"/api/v1/users/{user_id}", json={"is_active": False})
    assert response.json()["is_active"] is False


def test_last_admin_is_protected(admin: TestClient) -> None:
    me = admin.get("/api/v1/auth/me").json()
    response = admin.patch(f"/api/v1/users/{me['id']}", json={"role": "viewer"})
    assert response.status_code == 422


def test_engineer_cannot_manage_users(engineer: TestClient) -> None:
    assert engineer.get("/api/v1/users").status_code == 403
