/**
 * Style Me Chrome Extension - Background Service Worker
 * Handles API calls to OpenRouter for progressive outfit generation, manages communication with content scripts
 */

// Utility functions (included directly since ES6 imports aren't supported in service workers)

/**
 * Generates a hash for a URL to use as a cache key
 * @param {string} url - The URL to hash
 * @returns {string} - A simple hash string
 */
function generateUrlHash(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Retrieves cached product image if available
 * @param {string} productImageUrl - The URL of the product image
 * @returns {Promise<string|null>} - Cached base64 image or null if not found
 */
async function getCachedProductImage(productImageUrl) {
  try {
    const urlHash = generateUrlHash(productImageUrl);
    const cacheKey = `productImage_${urlHash}`;

    const result = await chrome.storage.local.get([cacheKey]);
    if (result[cacheKey] && result[cacheKey].image) {
      // Validate that the cached data has the expected structure
      if (
        typeof result[cacheKey].image === 'string' &&
        result[cacheKey].image.startsWith('data:')
      ) {
        console.log(`Found valid cached product image for: ${productImageUrl}`);
        return result[cacheKey];
      } else {
        console.warn(
          `Cached data corrupted for: ${productImageUrl}, removing from cache`
        );
        await chrome.storage.local.remove([cacheKey]);
        return null;
      }
    }
    return null;
  } catch (error) {
    console.error('Error retrieving cached product image:', error);
    return null;
  }
}

/**
 * Stores product image in cache for future reuse
 * @param {string} productImageUrl - The URL of the product image
 * @param {string} base64Image - The base64 encoded image to cache
 */
async function cacheProductImage(productImageUrl, base64Image) {
  try {
    const urlHash = generateUrlHash(productImageUrl);
    const cacheKey = `productImage_${urlHash}`;

    // Store the image with timestamp for potential future cleanup
    const cacheData = {
      image: base64Image,
      timestamp: Date.now(),
      url: productImageUrl,
    };

    await chrome.storage.local.set({ [cacheKey]: cacheData });
    console.log(`Cached product image for: ${productImageUrl}`);
  } catch (error) {
    console.error('Error caching product image:', error);
  }
}

/**
 * Cleans up old cached images to prevent storage bloat
 * @param {number} maxAge - Maximum age in milliseconds (default: 24 hours)
 */
async function cleanupOldCachedImages(maxAge = 24 * 60 * 60 * 1000) {
  try {
    const result = await chrome.storage.local.get(null);
    const now = Date.now();
    const keysToRemove = [];

    for (const [key, value] of Object.entries(result)) {
      if (key.startsWith('productImage_') && value.timestamp) {
        if (now - value.timestamp > maxAge) {
          keysToRemove.push(key);
        }
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`Cleaned up ${keysToRemove.length} old cached images`);
    }
  } catch (error) {
    console.error('Error cleaning up cached images:', error);
  }
}

/**
 * Get information about the current cache status
 */
async function getCacheInfo() {
  try {
    const result = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(result).filter((key) =>
      key.startsWith('productImage_')
    );

    let totalSize = 0;
    let validImages = 0;
    const cacheDetails = [];

    for (const key of cacheKeys) {
      const item = result[key];
      if (
        item &&
        item.image &&
        typeof item.image === 'string' &&
        item.image.startsWith('data:')
      ) {
        // Estimate size: base64 string length * 0.75 (approximate compression ratio)
        const estimatedSize = Math.round(item.image.length * 0.75);
        totalSize += estimatedSize;
        validImages++;

        cacheDetails.push({
          url: item.url,
          timestamp: item.timestamp,
          age: Date.now() - item.timestamp,
          ageHours:
            Math.round(
              ((Date.now() - item.timestamp) / (1000 * 60 * 60)) * 100
            ) / 100,
          size: estimatedSize,
          sizeKB: Math.round((estimatedSize / 1024) * 100) / 100,
        });
      }
    }

    return {
      totalCachedImages: cacheKeys.length,
      validCachedImages: validImages,
      totalSizeBytes: totalSize,
      totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
      averageImageSizeKB:
        validImages > 0
          ? Math.round((totalSize / validImages / 1024) * 100) / 100
          : 0,
      cacheDetails: cacheDetails.sort((a, b) => b.timestamp - a.timestamp), // Sort by newest first
    };
  } catch (error) {
    console.error('Error getting cache info:', error);
    throw error;
  }
}

/**
 * Converts an image URL to base64 data URL for API submission
 * @param {string} imageUrl - The URL of the image to convert
 * @returns {Promise<string>} - Base64 data URL
 */
async function convertUrlToBase64(imageUrl) {
  try {
    console.log(`Converting image to base64: ${imageUrl}`);

    // Fetch the image as a blob to avoid stack overflow with large images
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const blob = await response.blob();

    // Use FileReader to convert blob to base64 (avoids stack overflow)
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // reader.result is a data URL: "data:<mime>;base64,<data>"
        resolve(reader.result);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });

    // Optionally, ensure the mime type is correct (use response header if possible)
    let mimeType = response.headers.get('content-type');
    if (!mimeType) {
      // Fallback: determine from URL extension
      const url = new URL(imageUrl);
      const pathname = url.pathname.toLowerCase();
      if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      } else if (pathname.endsWith('.png')) {
        mimeType = 'image/png';
      } else if (pathname.endsWith('.webp')) {
        mimeType = 'image/webp';
      } else if (pathname.endsWith('.gif')) {
        mimeType = 'image/gif';
      } else {
        mimeType = 'image/jpeg'; // Default fallback
      }
    }

    // If the FileReader result already has the correct mime, just return it
    // Otherwise, replace the mime type in the data URL
    let result = base64;
    if (!base64.startsWith(`data:${mimeType}`)) {
      // Replace the mime type in the data URL
      result = base64.replace(/^data:.*?;base64,/, `data:${mimeType};base64,`);
    }

    console.log(
      `Converted to base64 (${mimeType}): ${result.substring(0, 50)}...`
    );
    return result;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

/**
 * Generates a single outfit image from multiple apparel items using OpenRouter/Gemini
 * Creates a composite image of all products and sends it to the API in one call
 * @param {string} apiKey - User's OpenRouter API key
 * @param {string} inputImageUrl - Base mannequin or input image URL
 * @param {Array<{name: string, image: string}>} products - List of apparel items with image URLs
 * @returns {Promise<string>} - Generated outfit image URL
 */
async function generateOutfitImage(apiKey, inputImageUrl, products) {
  if (!apiKey) throw new Error('API key is required');

  console.log(
    `Starting single composite outfit generation with ${products.length} products...`
  );

  // Step 1: Extract and prepare all product images
  const productImages = [];
  const productNames = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    console.log(
      `\n--- Processing product ${i + 1}/${products.length}: ${
        product.name
      } ---`
    );

    // Extract actual product image from the product image URL
    console.log(`Extracting actual product image for ${product.name}...`);
    let actualProductImageBase64;

    try {
      // Check if image is already cached
      const cachedImage = await getCachedProductImage(product.image);
      if (cachedImage && cachedImage.image) {
        console.log(`Using cached product image for ${product.name}`);
        actualProductImageBase64 = cachedImage.image;
      } else {
        actualProductImageBase64 = await extractActualProductImage(
          apiKey,
          product.image,
          product.name
        );
        console.log(
          `Successfully extracted actual product image for ${product.name} (API call)`
        );
      }
    } catch (extractError) {
      console.warn(
        `Failed to extract actual product image for ${product.name}, using original:`,
        extractError.message
      );
      // Fallback to original image if extraction fails
      actualProductImageBase64 = await convertUrlToBase64(product.image);
    }

    productImages.push(actualProductImageBase64);
    productNames.push(product.name);
  }

  // Step 2: Prepare product images for API (no composite needed in service worker)
  console.log('Preparing product images for API...');

  // Step 3: Build content parts for single API call
  const contentParts = [
    {
      type: 'text',
      text: `
Your task is to create a complete outfit by integrating ALL the provided apparel items onto the base model simultaneously.

**Apparel Items to Integrate:**
${productNames.map((name, index) => `${index + 1}. ${name}`).join('\n')}

**Instructions:**
1. **Integrate All Items Realistically:** Place ALL apparel items onto the model at once, ensuring they work together as a cohesive outfit.
2. **Layering & Coordination:** Consider how the items should be layered (e.g., shirt under jacket, pants with shirt tucked in).
3. **Match the Scene:** The lighting and shadows on ALL apparel must perfectly match the existing light source in the base image.
4. **Preserve Integrity:** Do not change the model's face, pose, body, or the background. All apparel colors, textures, and designs must remain identical to the product images provided.
5. **Outfit Harmony:** Ensure all items work together visually and functionally as a complete, stylish outfit.
`,
    },
    {
      type: 'image_url',
      image_url: {
        url: await convertUrlToBase64(inputImageUrl),
        detail: 'high_res',
      },
      text: 'This is the **Base Model Image** - the foundation for the outfit.',
    },
  ];

  // Add each product image separately to the content
  productImages.forEach((productImage, index) => {
    contentParts.push({
      type: 'image_url',
      image_url: {
        url: productImage,
        detail: 'high_res',
      },
      text: `This is **Apparel Item ${index + 1}**: ${productNames[index]}.`,
    });
  });

  // Step 4: Build request for single API call
  const request = {
    model: 'google/gemini-2.5-flash-image-preview:free',
    messages: [
      {
        role: 'system',
        content: `
***

## **ROLE**
You are an expert **Photorealistic Virtual Try-On Compositor** and **Digital Apparel Stylist**, specializing in creating hyper-realistic fashion imagery for e-commerce and marketing.

## **OBJECTIVE**
To seamlessly and authentically integrate MULTIPLE apparel items onto a base model image simultaneously, resulting in a high-fidelity, production-ready photograph of a complete outfit that is indistinguishable from real photography.

## **INPUTS**
* **Base Model Image:** A photograph of a human model in a specific pose and environment. This image defines the scene, lighting, and model's physical attributes.
* **Individual Apparel Images:** Multiple separate images, each containing one apparel item to be integrated, perfectly segmented and presented as if laid flat or on a "ghost" mannequin. Each image defines the exact appearance of its respective garment.

## **CORE EXECUTION WORKFLOW**

### **Multi-Item Integration (CRITICAL REALISM):**
* **Simultaneous Integration:** Integrate ALL apparel items at once, not one by one, ensuring they work together as a cohesive outfit.
* **Layering Logic:** Apply proper layering principles (e.g., undershirt beneath overshirt, shirt tucked into pants, jacket over shirt).
* **3D Form Adaptation:** Map ALL 2D apparel images onto the model's 3D body contours, accounting for the model's curves, muscles, and bone structure.
* **Dynamic Draping & Folds:** Generate realistic fabric folds, wrinkles, and creases for ALL items that respond to:
    * The model's pose and movement
    * The inherent properties of each fabric type
    * Gravity and natural hanging
    * How items interact with each other (e.g., shirt fabric under jacket)

### **Photometric Integration (Lighting & Shadows):**
* **Unified Shadow System:** Cast shadows from ALL garments onto the model's body and vice-versa, ensuring consistency with the base image's light source(s).
* **Light Interaction:** ALL apparel fabrics must reflect and absorb light consistently within the same light environment.
* **Inter-Item Shadows:** Generate realistic shadows between overlapping garments (e.g., jacket casting shadows on shirt underneath).

### **Apparel Integrity Preservation (Absolute Fidelity):**
* **NO Modification of Product Appearance:** The color, exact texture, fabric weave, graphic prints, embroidery, and any brand logos or labels for ALL items *must remain absolutely identical* to the provided product images.
* **Detail Retention:** Maintain all intricate details of ALL apparel items.

### **Scene Integrity (Unwavering Consistency):**
* **Base Image as Anchor:** The base model image serves as the immutable foundation. Do not alter the model's facial features, expression, hair, skin tone, or original posture.
* **Environment & Background:** The original background and environment must be preserved without any modifications.

## **EXCLUSIONS (Strict Adherence)**
* **NO Additions:** Do not introduce any new elements, accessories, props, text overlays, or external branding.
* **NO Stylization:** Do not apply any filters, color grading, or artistic effects that deviate from the native photographic style.
* **NO Distortions:** Avoid any unnatural stretching, warping, or blurring of the apparel or the model.

## **OUTPUT**
A single, high-resolution composite image presenting the model wearing ALL the specified apparel items as a complete, cohesive outfit, captured as if in a single, authentic photograph.`,
      },
      {
        role: 'user',
        content: contentParts,
      },
    ],
    temperature: 0.2,
  };

  console.log('Calling API with composite image for all products...');

  // Step 5: Call OpenRouter API once with all products
  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API Error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  console.log('API response received for composite outfit generation');

  // Step 6: Parse response to get the generated outfit image
  try {
    const contentStr = data.choices[0].message.content;
    console.log('Raw API response:', contentStr);

    // Check if there are generated images in the response
    if (
      data.choices[0].message.images &&
      data.choices[0].message.images.length > 0
    ) {
      const generatedImage = data.choices[0].message.images[0];
      console.log('Found generated outfit image:', generatedImage);

      if (generatedImage.image_url && generatedImage.image_url.url) {
        const imageUrl = generatedImage.image_url.url;

        // If it's a base64 image, return it directly
        if (imageUrl.startsWith('data:')) {
          console.log('Using base64 generated outfit image');
          return imageUrl;
        } else if (imageUrl.startsWith('http')) {
          return await convertUrlToBase64(imageUrl);
        }
      }
    }

    // If no images found, check text content for URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = contentStr.match(urlRegex);

    if (urls && urls.length > 0) {
      const imageUrl = urls[0];
      console.log('Found outfit image URL in text response:', imageUrl);
      return await convertUrlToBase64(imageUrl);
    } else {
      console.log('No outfit image found in response');
      throw new Error('Failed to generate outfit image');
    }
  } catch (err) {
    console.error('Error parsing outfit generation response:', err);
    throw err;
  }
}

/**
 * Extracts the actual product image from a product image URL using the API
 * This helps get high-quality, properly cropped product images for better outfit generation
 * @param {string} apiKey - User's OpenRouter API key
 * @param {string} productImageUrl - URL of the product image to extract
 * @param {string} productName - Name of the product for logging
 * @returns {Promise<string>} - Base64 data URL of the extracted product image
 */
async function extractActualProductImage(apiKey, productImageUrl, productName) {
  console.log(`Extracting actual product image from: ${productImageUrl}`);

  // Check for cached image first
  const cachedImage = await getCachedProductImage(productImageUrl);
  if (cachedImage && cachedImage.image) {
    console.log(`Using cached product image for: ${productImageUrl}`);
    return cachedImage.image;
  }

  // Convert the product image URL to base64
  const productImageBase64 = await convertUrlToBase64(productImageUrl);

  // Cache the newly fetched image
  await cacheProductImage(productImageUrl, productImageBase64);

  // Build request to extract the actual product image
  const request = {
    model: 'google/gemini-2.5-flash-image-preview:free',
    messages: [
      {
        role: 'system',
        content: `
***

## **INPUT ANALYSIS**

* **Source:** The input is a composite image (collage) containing multiple sub-images.
* **Content:** These sub-images display a single apparel product (a t-shirt) worn by a model from various angles and in different settings.
* **Primary Asset:** Your first task is to correctly identify this central t-shirt as the target for extraction.

## **CORE EXECUTION WORKFLOW**

### **View Identification & Selection**

* Scan all sub-images within the collage.
* Identify the **clearest, most complete, and front-facing view** of the t-shirt. This will be the source for your "Front View" asset.
* Identify the **clearest and most complete view of the back** of the t-shirt, ensuring the "RAMEN" graphic is fully visible. This will be the source for your "Back View" asset.

### **Synthesis and Extraction**

* **For the Front View:**
    * Meticulously segment the selected front view of the t-shirt from the model and its background.
    * Create a precise, clean-edged alpha mask around the t-shirt's entire silhouette (body, sleeves, collar).
    * The resulting image should appear as if the t-shirt is laid perfectly flat or on an invisible "ghost" mannequin.
* **For the Back View:**
    * Repeat the segmentation process for the selected back view. Pay special attention to preserving the integrity and detail of the large graphic print.

### **Integrity Preservation (CRITICAL)**

* The visual characteristics of the t-shirt fabric **must not be altered**.
* Preserve the original color (teal/dark blue), texture, fabric drape, and internal shadows.
* Ensure all graphics (the small chest logo on the front, the large graphic on the back) are retained with perfect fidelity.

## **FINAL OUTPUT SPECIFICATIONS**

* **Deliverables:** You will generate **one single image** of the product.
    * A standalone image of the product's **front perspective**.
* **Format:** The image must be a high-resolution **PNG file**.
* **Background:** The background for the image must be **100% transparent** (full alpha channel).
* **Canvas & Cropping:** Auto-crop the canvas of the final image to the bounding box of the t-shirt, leaving only minimal transparent padding.
* **Exclusions:** The final asset must be completely free of any original background, models, people, props, or text that is not part of the product's design.
`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
Your task is to extract the specified product from the provided image.

**Product to Extract:** ${productName}

**Instructions:**
1.  **Select View:** Analyze the image and identify the clearest, most complete, **front-facing view** of the product.
2.  **Isolate:** Meticulously segment this single view of the product from the model, background, and any other elements.
3.  **Output:** Generate one single image of the isolated product on a **100% transparent background**. The final image must be a clean PNG, tightly cropped around the product.
`,
          },
          {
            type: 'image_url',
            image_url: {
              url: productImageBase64,
              // Use 'high_res' for better detail during segmentation
              detail: 'high_res',
            },
          },
        ],
      },
    ],
    temperature: 0.2, // Low temperature for consistent extraction
  };

  console.log(`Calling API to extract product image for ${productName}...`);

  // Call OpenRouter API to extract the product image
  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Failed to extract product image for ${productName}: ${response.status} ${errText}`
    );
  }

  const data = await response.json();
  console.log(
    `Product image extraction API response received for ${productName}`
  );

  // Parse response to get the extracted product image
  try {
    const contentStr = data.choices[0].message.content;
    console.log(
      `Raw product extraction response for ${productName}:`,
      contentStr
    );

    // Check if there are generated images in the response
    if (
      data.choices[0].message.images &&
      data.choices[0].message.images.length > 0
    ) {
      const extractedImage = data.choices[0].message.images[0];
      console.log(
        `Found extracted product image for ${productName}:`,
        extractedImage
      );

      if (extractedImage.image_url && extractedImage.image_url.url) {
        const imageUrl = extractedImage.image_url.url;

        // If it's a base64 image, return it directly
        if (imageUrl.startsWith('data:')) {
          console.log(
            `Using base64 extracted image for extracted product ${productName}`
          );
          // Cache the extracted image for future reuse
          await cacheProductImage(productImageUrl, imageUrl);
          return imageUrl;
        } else if (imageUrl.startsWith('http')) {
          // Convert HTTP URL to base64
          const base64Image = await convertUrlToBase64(imageUrl);
          // Cache the extracted image for future reuse
          await cacheProductImage(productImageUrl, base64Image);
          return base64Image;
        }
      }
    }

    // If no images found, check text content for URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = contentStr.match(urlRegex);

    if (urls && urls.length > 0) {
      const imageUrl = urls[0];
      console.log(`Found extracted image URL for ${productName}:`, imageUrl);
      const base64Image = await convertUrlToBase64(imageUrl);
      // Cache the extracted image for future reuse
      await cacheProductImage(productImageUrl, base64Image);
      return base64Image;
    } else {
      console.log(`No extracted image found for ${productName}`);
      throw new Error(`Failed to extract product image for ${productName}`);
    }
  } catch (err) {
    console.error(
      `Error parsing product extraction response for ${productName}:`,
      err
    );
    throw err;
  }
}

class StyleMeBackgroundService {
  constructor() {
    this.init();
  }

  init() {
    this.setupMessageListener();
    this.setupExtensionClickHandler();
    this.setupCacheCleanup();
    console.log('Style Me Background Service initialized');
  }

  /**
   * Setup message listener for content script communication
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'STYLE_ME_CLICKED') {
        // Check if message contains product data or just image URL
        if (message.data && message.data.products) {
          // New format with product data
          this.handleStyleMeRequestWithData(message.data, sender.tab.id);
        }
        // Return true to indicate we'll send a response asynchronously
        return true;
      } else if (message.type === 'CLEAR_PRODUCT_CACHE') {
        // Handle cache clearing request
        this.clearProductImageCache()
          .then(() => {
            sendResponse({
              success: true,
              message: 'Product image cache cleared successfully',
            });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        return true;
      } else if (message.type === 'GET_CACHE_INFO') {
        // Handle cache info request
        this.getCacheInfoInternal()
          .then((info) => {
            sendResponse({ success: true, info });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        return true;
      } else if (message.type === 'CHECK_IMAGE_CACHED') {
        // Handle check if specific image is cached
        const { imageUrl } = message;
        getCachedProductImage(imageUrl)
          .then((cachedImage) => {
            sendResponse({
              success: true,
              isCached: !!cachedImage,
              hasImage: !!(cachedImage && cachedImage.image),
            });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        return true;
      } else if (message.type === 'PRELOAD_PRODUCT_IMAGES') {
        // Handle preload request
        const { imageUrls } = message;
        this.preloadProductImages(imageUrls)
          .then((results) => {
            sendResponse({ success: true, results });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
    });
  }

  /**
   * Setup periodic cache cleanup to prevent storage bloat
   */
  setupCacheCleanup() {
    // Clean up old cached images every 6 hours
    setInterval(() => {
      cleanupOldCachedImages();
    }, 6 * 60 * 60 * 1000);

    // Initial cleanup on startup
    cleanupOldCachedImages();
  }

  /**
   * Manually clear all cached product images
   */
  async clearProductImageCache() {
    try {
      const result = await chrome.storage.local.get(null);
      const keysToRemove = [];

      for (const key of Object.keys(result)) {
        if (key.startsWith('productImage_')) {
          keysToRemove.push(key);
        }
      }

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`Cleared ${keysToRemove.length} cached product images`);
      }
    } catch (error) {
      console.error('Error clearing product image cache:', error);
    }
  }

  /**
   * Preload and cache product images for better performance
   * @param {Array<string>} imageUrls - Array of product image URLs to preload
   */
  async preloadProductImages(imageUrls) {
    try {
      console.log(`Preloading ${imageUrls.length} product images...`);
      const results = [];

      for (const imageUrl of imageUrls) {
        try {
          // Check if already cached
          const cached = await getCachedProductImage(imageUrl);
          if (cached && cached.image) {
            console.log(`Image already cached: ${imageUrl}`);
            results.push({
              url: imageUrl,
              status: 'already_cached',
            });
            continue;
          }

          // Convert to base64 and cache
          const base64Image = await convertUrlToBase64(imageUrl);
          await cacheProductImage(imageUrl, base64Image);
          results.push({
            url: imageUrl,
            status: 'cached',
          });
          console.log(`Preloaded and cached: ${imageUrl}`);
        } catch (error) {
          console.error(`Failed to preload image: ${imageUrl}`, error);
          results.push({
            url: imageUrl,
            status: 'failed',
            error: error.message,
          });
        }
      }

      console.log(
        `Preloading complete: ${
          results.filter((r) => r.status === 'cached').length
        } new images cached`
      );
      return results;
    } catch (error) {
      console.error('Error preloading product images:', error);
      throw error;
    }
  }

  /**
   * Get information about the current cache status
   */
  async getCacheInfoInternal() {
    return await getCacheInfo();
  }

  /**
   * Setup extension icon click handler to open sidebar
   */
  setupExtensionClickHandler() {
    chrome.action.onClicked.addListener(async (tab) => {
      try {
        console.log('Extension icon clicked, opening sidebar...');

        // Check if content script is already running by trying to send a message first
        let contentScriptReady = false;
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: 'PING',
          });
          if (response && response.success) {
            contentScriptReady = true;
            console.log('Content script already running');
          }
        } catch (error) {
          console.log('Content script not running, will inject it');
        }

        // Only inject content script if it's not already running
        if (!contentScriptReady) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/content.js'],
            });
            console.log('Content script injected successfully');

            // Wait a moment for the script to initialize
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (injectError) {
            console.log('Content script injection failed:', injectError);
            return; // Don't proceed if injection fails
          }
        }

        // Send message to content script to open sidebar
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'OPEN_SIDEBAR',
        });

        if (response && response.success) {
          console.log('Sidebar opened successfully');
        } else {
          console.error('Failed to open sidebar:', response?.error);

          // Try one more time after a longer delay
          setTimeout(async () => {
            try {
              const retryResponse = await chrome.tabs.sendMessage(tab.id, {
                type: 'OPEN_SIDEBAR',
              });
              if (retryResponse && retryResponse.success) {
                console.log('Sidebar opened successfully on retry');
              } else {
                console.error('Retry failed:', retryResponse?.error);
              }
            } catch (retryError) {
              console.error('Retry failed:', retryError);
            }
          }, 1000);
        }
      } catch (error) {
        console.error('Error opening sidebar:', error);
      }
    });
  }

  /**
   * Handle Style Me request from content script with product data
   */
  async handleStyleMeRequestWithData(data, tabId) {
    try {
      console.log(
        '🚀 Starting Style Me request with progressive outfit generation...'
      );

      // Step 1: Retrieve stored data
      const storedData = await this.retrieveStoredData();

      if (!storedData.apiKey || !storedData.userImage) {
        this.sendErrorToTab(
          tabId,
          'Missing API key or user image. Please configure the extension first.'
        );
        return;
      }

      // Step 2: Prepare products array for progressive generation
      const products = data.products;
      const userImage = data.userImage ?? storedData.userImage;

      // Step 3: Generate outfit progressively using the new function
      console.log('🎨 Generating outfit progressively...');
      const generatedImage = await generateOutfitImage(
        storedData.apiKey,
        userImage,
        products
      );

      if (!generatedImage) {
        throw new Error('Failed to generate outfit. Please try again.');
      }

      // Step 4: Send success response to content script
      this.sendSuccessToTab(tabId, generatedImage);
    } catch (error) {
      console.error('Error handling Style Me request:', error);
      this.sendErrorToTab(tabId, error.message || 'Failed to generate style');
    }
  }

  /**
   * Retrieve stored API key and user image
   */
  async retrieveStoredData() {
    try {
      const result = await chrome.storage.local.get([
        'openRouterApiKey',
        'userImage',
      ]);

      if (!result.openRouterApiKey) {
        throw new Error(
          'API key not found. Please configure the extension first.'
        );
      }

      if (!result.userImage) {
        throw new Error('User image not found. Please upload a photo first.');
      }

      return {
        apiKey: result.openRouterApiKey,
        userImage: result.userImage,
      };
    } catch (error) {
      console.error('Error retrieving stored data:', error);
      throw error;
    }
  }

  /**
   * Send success response to content script
   */
  sendSuccessToTab(tabId, generatedImage) {
    try {
      chrome.tabs.sendMessage(tabId, {
        type: 'STYLE_ME_SUCCESS',
        generatedImage: generatedImage,
      });
    } catch (error) {
      console.error('Error sending success message to tab:', error);
    }
  }

  /**
   * Send error response to content script
   */
  sendErrorToTab(tabId, errorMessage) {
    try {
      chrome.tabs.sendMessage(tabId, {
        type: 'STYLE_ME_ERROR',
        error: errorMessage,
      });
    } catch (error) {
      console.error('Error sending error message to tab:', error);
    }
  }

  /**
   * Handle extension installation
   */
  handleInstall() {
    console.log('Style Me extension installed');

    // Set default values if needed
    chrome.storage.local.get(['openRouterApiKey', 'userImage'], (result) => {
      if (!result.openRouterApiKey) {
        console.log('No API key found - user needs to configure extension');
      }
      if (!result.userImage) {
        console.log('No user image found - user needs to upload photo');
      }
    });
  }

  /**
   * Handle extension update
   */
  handleUpdate() {
    console.log('Style Me extension updated');
  }
}

// Initialize the background service
const styleMeBackground = new StyleMeBackgroundService();

// Handle extension lifecycle events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    styleMeBackground.handleInstall();
  } else if (details.reason === 'update') {
    styleMeBackground.handleUpdate();
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Style Me extension started');
});
