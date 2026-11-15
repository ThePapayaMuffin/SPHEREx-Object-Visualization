"""Build public/sky_equirect.png (4096x2048, RA 0..360 left->right, Dec +90 top).
Placeholder: procedural. TODO real data: pull SPHEREx quick-release spectral-image mosaics from IRSA
(https://irsa.ipac.caltech.edu/Missions/spherex.html), pick one band, reproject onto an equirect WCS
(`reproject` + `astropy.wcs`), stretch with asinh, save PNG. Needs network access to IRSA."""
import numpy as np
from PIL import Image
W, H = 4096, 2048
rng = np.random.default_rng(7)
img = np.zeros((H, W, 3), np.float32)
y = np.linspace(-1, 1, H)[:, None]
img += np.exp(-(y / 0.12) ** 2)[..., None] * np.array([.25, .1, .05])   # fake galactic plane
for _ in range(40000):
    img[rng.integers(H), rng.integers(W)] = rng.random() ** 3 * np.array([1, .7, .45]) + .3
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save("public/sky_equirect.png")
