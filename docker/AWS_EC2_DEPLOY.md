# AWS EC2 deploy guide for AgriDoctorAI

Current target environment:

- EC2 public IP: `54.173.14.193`
- region: `us-east-1`
- OS: `Ubuntu 26.04 LTS`
- app directory on EC2: `~/plant-disease-app`
- host reverse proxy: `Nginx`
- containers: `MongoDB` + `api-server`

This guide matches the current deployment workflow:

1. package source as `tar.gz`
2. upload archives with `scp -C`
3. extract into `~/plant-disease-app`
4. copy `docker/docker-compose.prod.yml` to `docker-compose.yml`
5. build the Docker image locally on EC2 from source
6. run `docker compose --env-file .env up -d`
7. seed Mongo
8. expose the API through Nginx over HTTP

## 1. Required local files

Before packaging, verify these paths exist locally:

- `server/`
- `python/`
- `docker/`
- `.env.example`
- `runs/classify/train_crop_type/weights/best.pt`
- `runs/detect/train_nano_updated/weights/best.pt` if you rely on the general fallback detector

If `runs/detect/train_nano_updated/weights/best.pt` is missing, `/api/detect` can still fail even when the stack itself is healthy.

## 2. Package source on the local machine

From the repo root:

```bash
tar -czf deploy-src.tar.gz .env.example .dockerignore docker server python
tar -czf deploy-runs.tar.gz runs
```

These archives are preferred over `scp -r` because long recursive uploads were unstable.

## 3. Upload the archives to EC2

Recommended upload command:

```bash
scp -C -o ServerAliveInterval=30 -o ServerAliveCountMax=10 deploy-src.tar.gz deploy-runs.tar.gz ubuntu@54.173.14.193:~/
```

If you use a PEM key:

```bash
scp -i /path/to/key.pem -C -o ServerAliveInterval=30 -o ServerAliveCountMax=10 deploy-src.tar.gz deploy-runs.tar.gz ubuntu@54.173.14.193:~/
```

## 4. Extract source on EC2

SSH into the instance:

```bash
ssh ubuntu@54.173.14.193
```

Or with a PEM key:

```bash
ssh -i /path/to/key.pem ubuntu@54.173.14.193
```

Then extract:

```bash
mkdir -p ~/plant-disease-app
tar -xzf ~/deploy-src.tar.gz -C ~/plant-disease-app
tar -xzf ~/deploy-runs.tar.gz -C ~/plant-disease-app
cp ~/plant-disease-app/docker/docker-compose.prod.yml ~/plant-disease-app/docker-compose.yml
```

## 5. Install Docker and Nginx on EC2

```bash
sudo apt update
sudo apt install -y ca-certificates curl nginx

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo systemctl enable --now nginx
sudo usermod -aG docker $USER
```

Log out and back in once after adding the user to the Docker group.

## 6. Create `.env` on EC2

```bash
cd ~/plant-disease-app
cp .env.example .env
nano .env
```

Set these values at minimum:

- `JWT_SECRET`
- `PUBLIC_IP=54.173.14.193`
- `MONGODB_URI=mongodb://mongodb:27017/plant_disease_db`
- `EMAIL_USER`
- `EMAIL_PASS`
- `GEMINI_API_KEY`

Important notes:

- `JWT_SECRET` is mandatory. If it is missing, the API crashes on startup in `auth.middleware.js`.
- `EMAIL_PASS` must be a Google App Password, not a normal Gmail password.
- `USE_HTTPS=false` is expected for the current IP-only HTTP deployment.

## 7. Build the API image locally on EC2

Do not use the old Docker Hub image. Build from the uploaded source:

```bash
cd ~/plant-disease-app
docker build -t plant-disease-api:latest -f docker/Dockerfile.server .
```

This Dockerfile already includes:

- `python3`
- `libgl1`
- `libglib2.0-0`
- CPU-only `torch` / `torchvision`

Those packages are required because previous builds failed with:

- `/bin/sh: 1: python: not found`
- `ImportError: libGL.so.1`
- disk exhaustion from CUDA wheels

## 8. Start the stack

```bash
cd ~/plant-disease-app
docker compose --env-file .env up -d
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 api-server
```

If you change `.env`, restart with the same `--env-file .env` form:

```bash
docker compose --env-file .env up -d
```

## 9. Seed MongoDB

After `api-server` is healthy:

```bash
cd ~/plant-disease-app
docker compose --env-file .env exec api-server npm run seed
```

## 10. Configure Nginx

Copy the repo config:

```bash
sudo cp ~/plant-disease-app/docker/nginx/plant-disease-api.conf /etc/nginx/sites-available/plant-disease-api
```

Enable the site:

```bash
sudo ln -sf /etc/nginx/sites-available/plant-disease-api /etc/nginx/sites-enabled/plant-disease-api
sudo nginx -t
sudo systemctl reload nginx
```

For the current deployment, `server_name` can remain `54.173.14.193`.

## 11. Verify the deployment

Check the API directly on the EC2 host:

```bash
curl http://127.0.0.1:3000/health
```

Check through Nginx:

```bash
curl http://54.173.14.193/health
```

Current expected result: both health checks should return success.

## 12. Known issues to watch

- If detect fails, inspect `~/plant-disease-app/runs` first.
- The most likely missing model is `runs/detect/train_nano_updated/weights/best.pt`.
- Signup and forgot-password can fail if Gmail returns `535 BadCredentials`.
- If auth routes fail at startup, re-check `JWT_SECRET` in `.env`.

## 13. Current security posture

Current public deployment is HTTP-only because there is no domain and no certbot certificate yet.

That means:

- traffic is not protected in transit
- HTTPS should be enabled as soon as a domain is available

When you have a domain:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

At that point you should switch Nginx to HTTPS and update:

- `PUBLIC_IP`
- `ALLOWED_ORIGINS`
- Android `API_BASE_URL`

## 14. Debugging priority order

When something breaks, inspect in this order:

1. `docker compose --env-file .env ps`
2. `docker compose --env-file .env logs --tail=100 api-server`
3. `ls -R ~/plant-disease-app/runs | head`
4. `curl http://127.0.0.1:3000/health`
5. `curl http://54.173.14.193/health`

Do not fall back to the old Docker Hub image during debugging. The current deployment path is source upload plus local build on EC2.
