/**
 * Style Me Chrome Extension - Background Service Worker
 * Handles API calls to OpenRouter for progressive outfit generation, manages communication with content scripts
 */

// Utility functions (included directly since ES6 imports aren't supported in service workers)

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
 * Builds up the outfit progressively by adding one product at a time
 * First extracts actual product images from URLs, then generates the outfit
 * @param {string} apiKey - User's OpenRouter API key
 * @param {string} inputImageUrl - Base mannequin or input image URL
 * @param {Array<{name: string, image: string}>} products - List of apparel items with image URLs
 * @returns {Promise<string>} - Generated outfit image URL
 */
async function generateOutfitImage(apiKey, inputImageUrl, products) {
  if (!apiKey) throw new Error('API key is required');

  console.log(
    `Starting progressive outfit generation with ${products.length} products...`
  );

  // Start with the base image
  let currentBaseImageBase64 = await convertUrlToBase64(inputImageUrl);

  // Process each product one by one, building up the outfit
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    console.log(
      `\n--- Processing product ${i + 1}/${products.length}: ${
        product.name
      } ---`
    );

    // Step 1: Extract actual product image from the product image URL
    console.log(`Extracting actual product image for ${product.name}...`);
    let actualProductImageBase64;

    try {
      actualProductImageBase64 = await extractActualProductImage(
        apiKey,
        product.image,
        product.name
      );
      console.log(
        `Successfully extracted actual product image for ${product.name}`
      );
    } catch (extractError) {
      console.warn(
        `Failed to extract actual product image for ${product.name}, using original:`,
        extractError.message
      );
      // Fallback to original image if extraction fails
      actualProductImageBase64 = await convertUrlToBase64(product.image);
    }

    // Step 2: Build content parts for outfit generation using the extracted product image
    const contentParts = [
      {
        type: 'text',
        text: `Base image`,
      },
      {
        type: 'image_url',
        image_url: {
          url: currentBaseImageBase64,
          detail: `base image`,
        },
      },
      {
        type: 'text',
        text: `Apparel to add: ${product.name}`,
      },
      {
        type: 'image_url',
        image_url: {
          url: actualProductImageBase64,
          detail: `apparel item - ${product.name}`,
        },
      },
    ];

    // Build request for this iteration
    const request = {
      model: 'google/gemini-2.5-flash-image-preview:free',
      messages: [
        {
          role: 'system',
          content: `## ROLE
              You are a professional digital imaging specialist, an expert in photorealistic virtual try-on compositing.

              ## OBJECTIVE
              To seamlessly and realistically integrate a provided apparel item onto a base model image, creating a high-fidelity, authentic-looking final image.

              ## INPUTS
              *   **Base Image:** [Link/description of the image with the model]
              *   **Apparel Image:** [Link/description of the isolated product image]

              ## CORE INSTRUCTIONS
              1.  **High-Fidelity Product Transfer:**
                  *   Overlay the apparel from the [Apparel Image] onto the model in the [Base Image].
                  *   Preserve the apparel's appearance with absolute fidelity. The color, texture, fabric pattern, sheen, and any logos must remain identical to the source.

              2.  **Realistic Fit and Drape:**
                  *   The apparel must be realistically conformed to the model's body, posture, and perspective.
                  *   Account for natural draping, folds, and shadows consistent with the existing lighting in the [Base Image]. The integration must be seamless, with no visible edges or artifacts.

              3.  **Preserve Scene Integrity:**
                  *   The [Base Image] serves as the unaltered canvas. Do not modify the model's pose, expression, hair, or skin.
                  *   The background, environment, and all original lighting conditions must be strictly maintained.

              4.  **Exclusions:**
                  *   Do not add any new elements: no accessories, props, text, logos, or environmental objects.
                  *   Do not apply any stylistic filters or color grading. The final output should match the photographic style of the original base image.

              ## OUTPUT
              A single, high-resolution composite image that looks like an authentic photograph of the model wearing the specified apparel.`,
        },
        {
          role: 'user',
          content: contentParts,
        },
      ],
      temperature: 0.2,
    };

    console.log(`Calling API for ${product.name}...`);

    // Call OpenRouter API for this product
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
        `OpenRouter API Error for ${product.name}: ${response.status} ${errText}`
      );
    }

    const data = await response.json();
    console.log(`API response received for ${product.name}`);

    // Parse response content to get the new base image
    try {
      const contentStr = data.choices[0].message.content;
      console.log(`Raw API response for ${product.name}:`, contentStr);

      // Check if there are generated images in the response
      if (
        data.choices[0].message.images &&
        data.choices[0].message.images.length > 0
      ) {
        const generatedImage = data.choices[0].message.images[0];
        console.log(
          `Found generated image for ${product.name}:`,
          generatedImage
        );

        if (generatedImage.image_url && generatedImage.image_url.url) {
          const imageUrl = generatedImage.image_url.url;

          // If it's a base64 image, use it directly as the new base
          if (imageUrl.startsWith('data:')) {
            console.log(`Using base64 image as new base for ${product.name}`);
            currentBaseImageBase64 = imageUrl;
            continue; // Move to next product
          } else if (imageUrl.startsWith('http')) {
            currentBaseImageBase64 = await convertUrlToBase64(imageUrl);
            continue; // Move to next product
          }
        }
      }

      // If no images found, check text content for URLs
      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = contentStr.match(urlRegex);

      if (urls && urls.length > 0) {
        const imageUrl = urls[0];
        console.log(
          `Found image URL in text response for ${product.name}:`,
          imageUrl
        );
        currentBaseImageBase64 = await convertUrlToBase64(imageUrl);
        continue; // Move to next product
      } else {
        console.log(`No image found in response for ${product.name}`);
        throw new Error(`Failed to generate image for ${product.name}`);
      }
    } catch (err) {
      console.error(`Error parsing response for ${product.name}:`, err);
      throw err;
    }
  }

  // Return the final generated image
  console.log('\n--- Final outfit generation complete ---');
  return currentBaseImageBase64;
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

  // Convert the product image URL to base64
  const productImageBase64 = await convertUrlToBase64(productImageUrl);

  // Build request to extract the actual product image
  const request = {
    model: 'mistralai/mistral-small-3.2-24b-instruct:free',
    messages: [
      {
        role: 'system',
        content: `## ROLE
You are an expert Digital Asset Processor, specializing in high-fidelity product segmentation for e-commerce and virtual try-on (VTO) pipelines.

## OBJECTIVE
To meticulously isolate the primary apparel item from a source image, removing all extraneous elements and delivering a production-ready asset with a transparent background.

## CORE INSTRUCTIONS

1.  **Intelligent Segmentation:**
    *   Identify the main product/apparel item in the source image, distinguishing it from the model, background, and any props.
    *   Generate a precise and clean-edged alpha mask around the product's complete silhouette.

2.  **Background & Element Removal:**
    *   Completely remove the original background to achieve full transparency.
    *   Purge all non-product elements, including (but not limited to): people, props, text, user-interface elements, watermarks, and external logos.

3.  **Preserve Product Integrity:**
    *   The visual attributes of the product itself must be preserved with absolute fidelity.
    *   Do NOT alter the product's original color, texture, fabric pattern, sheen, or internal shadows. The goal is isolation, not modification.

4.  **Final Output Specifications:**
    *   Render the final image as a high-resolution PNG file with a transparent alpha channel.
    *   Auto-crop the canvas to the product's bounding box, leaving only minimal, necessary padding.
    *   The output must be a clean, standalone representation of the product.
        `,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Product: ${productName}`,
          },
          {
            type: 'image_url',
            image_url: {
              url: productImageBase64,
              detail: `product image to extract`,
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
          console.log(`Using base64 extracted image for ${productName}`);
          return imageUrl;
        } else if (imageUrl.startsWith('http')) {
          // Convert HTTP URL to base64
          return await convertUrlToBase64(imageUrl);
        }
      }
    }

    // If no images found, check text content for URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = contentStr.match(urlRegex);

    if (urls && urls.length > 0) {
      const imageUrl = urls[0];
      console.log(`Found extracted image URL for ${productName}:`, imageUrl);
      return await convertUrlToBase64(imageUrl);
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
      }
    });
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
