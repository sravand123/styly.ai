/**
 * Style Me Chrome Extension - Content Script
 * Injects "Try On" buttons on product images and manages sidebar functionality
 * Supports: Myntra
 */

class StyleMeContentScript {
  constructor() {
    this.sidebar = null;
    this.sidebarOpen = false;
    this.savedProducts = [];
    this.currentSite = this.detectSite();
    this.processedRequests = new Set(); // Track processed requests to prevent infinite loops
    this.tempUserImage = null; // Initialize tempUserImage
    this.buttonStyle = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      transition: all 0.3s ease;
      opacity: 0;
      pointer-events: none;
    `;

    this.init();
  }

  init() {
    console.log('Style Me content script initializing...');
    this.setupMessageListener();
    this.loadSavedProducts();
    this.injectButtons();
    this.setupMutationObserver();

    // Add periodic check to ensure all cards get buttons
    this.setupPeriodicCheck();

    console.log(`Style Me initialized on ${this.currentSite}`);
  }

  /**
   * Initialize for Myntra
   */
  detectSite() {
    return 'myntra';
  }

  /**
   * Setup message listener for background script communication
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Prevent infinite loops by checking message source and request ID
      if (message.source === 'content_script') {
        console.log(
          'Ignoring message from content script to prevent infinite loop:',
          message
        );
        return;
      }

      // Check if we've already processed this request
      if (message.requestId && this.processedRequests.has(message.requestId)) {
        console.log('Request already processed, ignoring:', message.requestId);
        return;
      }

      // Mark request as processed
      if (message.requestId) {
        this.processedRequests.add(message.requestId);
      }

      switch (message.type) {
        case 'PING':
          sendResponse({ success: true });
          break;
        case 'OPEN_SIDEBAR':
          this.openSidebar();
          sendResponse({ success: true });
          break;
        case 'STYLE_ME_SUCCESS':
          this.handleStyleSuccess(message.generatedImage);
          break;
        case 'STYLE_ME_ERROR':
          this.handleStyleError(message.error);
          break;
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    });
  }

  /**
   * Get product card selectors for Myntra
   */
  getProductCardSelectors() {
    const selectors = [
      // Primary product card selectors
      '.product-base', // Product card on listing pages
      '.pdp-product', // Product card on product detail page
      '.product-card', // Alternative product card
      '.product-tile', // Product tile

      // Product cards with product ID
      '.product-base[data-productid]', // Product base with ID
      '.product-card[data-productid]', // Product card with ID
      '.product-tile[data-productid]', // Product tile with ID

      // Alternative product card classes
      '.product-base[data-productid]:not([data-productid=""])', // Product base with non-empty ID
      '.product-card[data-productid]:not([data-productid=""])', // Product card with non-empty ID
      '.product-tile[data-productid]:not([data-productid=""])', // Product tile with non-empty ID

      // Grid and list item selectors
      '.product-base.product-card', // Product base with card class
      '.product-base.product-tile', // Product base with tile class
      '.product-card.product-tile', // Product card with tile class

      // Search result specific selectors
      '.product-base[data-testid*="product"]', // Product base with test ID
      '.product-card[data-testid*="product"]', // Product card with test ID
      '.product-tile[data-testid*="product"]', // Product tile with test ID

      // Alternative layout selectors
      '.product-base.product-card[data-productid]', // Complex product base with ID
      '.product-card.product-tile[data-productid]', // Complex product card with ID
      '.product-base.product-tile[data-productid]', // Complex product base with tile and ID

      // Generic product containers
      '[data-productid]:not([data-productid=""])', // Any element with non-empty product ID
      '.product', // Generic product class
      '.product-item', // Generic product item class
      '.product-container', // Generic product container

      // Category and listing page selectors
      '.product-base[data-category]', // Product base with category
      '.product-card[data-category]', // Product card with category
      '.product-tile[data-category]', // Product tile with category

      // Brand specific selectors
      '.product-base[data-brand]', // Product base with brand
      '.product-card[data-brand]', // Product card with brand
      '.product-tile[data-brand]', // Product tile with brand

      // Price range selectors
      '.product-base[data-price-range]', // Product base with price range
      '.product-card[data-price-range]', // Product card with price range
      '.product-tile[data-price-range]', // Product tile with price range
    ];

    return selectors;
  }

  /**
   * Get product image selectors for Myntra
   */
  getProductImageSelectors() {
    const selectors = [
      // Primary product image selectors
      '.product-image img', // Standard product images
      '.product-imageSlider img', // Product slider images

      // Myntra CDN image selectors
      'img[src*="assets.myntassets.com"]', // Main assets CDN
      'img[src*="myntra.com"]', // Myntra domain images
      'img[src*="myntraassets.com"]', // Alternative assets CDN
      'img[src*="myntra.net"]', // Alternative domain

      // Alternative image selectors
      'img[alt*="product"]', // Images with product in alt text
      'img[alt*="Product"]', // Images with Product in alt text
      'img[alt*="image"]', // Images with image in alt text
      'img[alt*="Image"]', // Images with Image in alt text

      // Specific image classes
      '.product-image', // Product image container
      '.product-imageSlider', // Product slider container
      '.product-base img', // Product base images
      '.product-card img', // Product card images
      '.product-tile img', // Product tile images

      // Image container selectors
      '.product-image[style*="background-image"]', // Background image containers
      '.product-imageSlider[style*="background-image"]', // Slider background containers

      // Product detail page images
      '.pdp-image img', // Product detail page images
      '.pdp-imageSlider img', // Product detail slider images
      '.product-sliderContainer img', // Product slider container images

      // Generic product images
      'img[src*="product"]', // Any image with product in URL
      'img[src*="Product"]', // Any image with Product in URL
      'img[src*="item"]', // Any image with item in URL
      'img[src*="Item"]', // Any image with Item in URL

      // Search result specific images
      '.product-base img', // Product base images
      '.product-card img', // Product card images
      '.product-tile img', // Product tile images

      // Alternative image containers
      '.image-grid-image', // Image grid images
      '.image-grid-imageContainer img', // Image grid container images
    ];

    return selectors;
  }

  /**
   * Collect all images from image sliders in a product card
   * @param {Element} productCard - The product card element
   * @returns {Array<string>} - Array of image URLs
   */
  collectAllSliderImages(productCard) {
    const allImages = [];

    // Try to find image sliders first
    const sliderSelectors = [
      '.product-imageSlider img',
      '.pdp-imageSlider img',
      '.product-sliderContainer img',
      '.image-grid-image img',
      '.image-grid-imageContainer img',
      '.product-image img',
      '.pdp-image img',
    ];

    // Collect all images from sliders
    for (const selector of sliderSelectors) {
      const images = productCard.querySelectorAll(selector);
      if (images.length > 0) {
        images.forEach((img) => {
          if (img.src && !allImages.includes(img.src)) {
            allImages.push(img.src);
          }
        });
        break; // Use the first slider that has images
      }
    }

    // If no slider images found, try to find any product images
    if (allImages.length === 0) {
      const fallbackSelectors = [
        'img[src*="assets.myntassets.com"]',
        'img[src*="myntra.com"]',
        'img[src*="myntraassets.com"]',
        'img[src*="myntra.net"]',
        'img[alt*="product"]',
        'img[alt*="Product"]',
      ];

      for (const selector of fallbackSelectors) {
        const images = productCard.querySelectorAll(selector);
        if (images.length > 0) {
          images.forEach((img) => {
            if (img.src && !allImages.includes(img.src)) {
              allImages.push(img.src);
            }
          });
          break;
        }
      }
    }

    // Filter out duplicate URLs and ensure we have valid images
    const uniqueImages = [...new Set(allImages)].filter(
      (url) =>
        url && url.trim() && !url.includes('data:') && url.startsWith('http')
    );

    console.log(`Collected ${uniqueImages.length} images for product`);
    return uniqueImages;
  }

  /**
   * Create a composite image from multiple product images
   * @param {Array<string>} imageUrls - Array of image URLs
   * @returns {Promise<string>} - Base64 data URL of composite image
   */
  async createCompositeImage(imageUrls) {
    return new Promise((resolve, reject) => {
      try {
            // No padding between images
            const imagesPerRow = 3;
            const imageWidth = 240; // Use a fixed width for each image
            const imageHeight = 240; // Use a fixed height for each image (square for no gaps)
            const rows = Math.ceil(imageUrls.length / imagesPerRow);
            const totalWidth = imagesPerRow * imageWidth;
            const totalHeight = rows * imageHeight;

            // Create canvas
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = totalWidth;
            canvas.height = totalHeight;

            // Fill background (optional, can be transparent if you want)
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, totalWidth, totalHeight);

            let loadedImages = 0;
            const totalImages = imageUrls.length;

            imageUrls.forEach((url, index) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';

              img.onload = () => {
                // Calculate position in grid (no padding)
                const row = Math.floor(index / imagesPerRow);
                const col = index % imagesPerRow;
                const x = col * imageWidth;
                const y = row * imageHeight;

                // Draw image to fill the cell, cropping if necessary to maintain quality and fill
                // Calculate aspect ratio and crop to fill the cell
                const cellAR = imageWidth / imageHeight;
                const imgAR = img.width / img.height;
                let sx = 0,
                  sy = 0,
                  sw = img.width,
                  sh = img.height;

                if (imgAR > cellAR) {
                  // Image is wider than cell, crop sides
                  sw = img.height * cellAR;
                  sx = (img.width - sw) / 2;
                } else if (imgAR < cellAR) {
                  // Image is taller than cell, crop top/bottom
                  sh = img.width / cellAR;
                  sy = (img.height - sh) / 2;
                }
                ctx.drawImage(
                  img,
                  sx,
                  sy,
                  sw,
                  sh,
                  x,
                  y,
                  imageWidth,
                  imageHeight
                );

                loadedImages++;
                if (loadedImages === totalImages) {
                  try {
                    // Use PNG for lossless quality
                    const compositeBase64 = canvas.toDataURL('image/png');
                    resolve(compositeBase64);
                  } catch (error) {
                    console.error('Error converting canvas to base64:', error);
                    reject(error);
                  }
                }
              };

              img.onerror = () => {
                console.warn(`Failed to load image: ${url}`);
                loadedImages++;

                // Draw placeholder for failed image
                const row = Math.floor(index / imagesPerRow);
                const col = index % imagesPerRow;
                const x = col * imageWidth;
                const y = row * imageHeight;

                ctx.fillStyle = '#e9ecef';
                ctx.fillRect(x, y, imageWidth, imageHeight);
                ctx.fillStyle = '#6c757d';
                ctx.font = '14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(
                  'Image Failed',
                  x + imageWidth / 2,
                  y + imageHeight / 2
                );

                if (loadedImages === totalImages) {
                  try {
                    const compositeBase64 = canvas.toDataURL('image/png');
                    resolve(compositeBase64);
                  } catch (error) {
                    console.error('Error converting canvas to base64:', error);
                    reject(error);
                  }
                }
              };

              img.src = url;
            });

            // Handle case where no images load
            if (totalImages === 0) {
              resolve(canvas.toDataURL('image/png'));
            }
          } catch (error) {
        console.error('Error creating composite image:', error);
        reject(error);
      }
    });
  }

  /**
   * Extract product information from product card
   */
  async getProductInfo(imgElement) {
    let productName = 'Product';
    let productPrice = '';
    let imageUrl = '';
    let allImages = [];

    // Extract image URL
    if (imgElement.src) {
      imageUrl = imgElement.src;
    } else if (imgElement.style && imgElement.style.backgroundImage) {
      const match = imgElement.style.backgroundImage.match(
        /url\(['"]?([^'"]+)['"]?\)/
      );
      if (match) imageUrl = match[1];
    }

    // Find the product card containing this image
    const productCard = imgElement.closest(
      this.getProductCardSelectors().join(',')
    );

    if (productCard) {
      // Collect all slider images
      allImages = this.collectAllSliderImages(productCard);

      // If we have multiple images, create a composite image and use it as the main image
      if (allImages.length > 1) {
        try {
          console.log(
            `Creating composite image for product with ${allImages.length} images`
          );
          imageUrl = await this.createCompositeImage(allImages);
          console.log(
            'Composite image created and set as main image:',
            imageUrl
          );
          console.log('Composite image created and set as main image');
        } catch (error) {
          console.warn(
            'Failed to create composite image, using first image:',
            error.message
          );
          // Fallback to first image if composite creation fails
          if (allImages.length > 0) {
            imageUrl = allImages[0];
          }
        }
      } else if (allImages.length === 1) {
        // Use the single image
        imageUrl = allImages[0];
      }

      // Extract product information from Myntra product card
      // Try multiple title selectors for better coverage
      const myntraTitleSelectors = [
        '.product-product', // Product name
        '.product-name', // Product name
        '.product-brand', // Product brand
        'h3', // Heading 3
        'h4', // Heading 4
        'h5', // Heading 5
        '.product-base .product-product', // Product base with product
        '.product-card .product-product', // Product card with product
        '.product-tile .product-product', // Product tile with product
        '.product-base .product-name', // Product base with name
        '.product-card .product-name', // Product card with name
        '.product-tile .product-name', // Product tile with name
        '.product-base .product-brand', // Product base with brand
        '.product-card .product-brand', // Product card with brand
        '.product-tile .product-brand', // Product tile with brand
        '.product-title', // Generic product title
        '.item-title', // Generic item title
        '.title', // Generic title
        'a[title]', // Link with title attribute
        '.product-base a[title]', // Product base link with title
        '.product-card a[title]', // Product card link with title
        '.product-tile a[title]', // Product tile link with title
      ];

      let myntraTitle = null;
      for (const selector of myntraTitleSelectors) {
        myntraTitle = productCard.querySelector(selector);
        if (myntraTitle && myntraTitle.textContent.trim()) {
          break;
        }
      }

      if (myntraTitle) {
        productName = myntraTitle.textContent.trim().substring(0, 50);
      }

      // Try multiple price selectors for better coverage
      const myntraPriceSelectors = [
        '.product-discountedPrice', // Discounted price
        '.product-price', // Product price
        '.price', // Generic price
        '.product-base .product-discountedPrice', // Product base with discounted price
        '.product-card .product-discountedPrice', // Product card with discounted price
        '.product-tile .product-discountedPrice', // Product tile with discounted price
        '.product-base .product-price', // Product base with price
        '.product-card .product-price', // Product card with price
        '.product-tile .product-price', // Product tile with price
        '.discount-price', // Discount price
        '.original-price', // Original price
        '.current-price', // Current price
        '.sale-price', // Sale price
        '.offer-price', // Offer price
        '.final-price', // Final price
      ];

      let myntraPrice = null;
      for (const selector of myntraPriceSelectors) {
        myntraPrice = productCard.querySelector(selector);
        if (myntraPrice && myntraPrice.textContent.trim()) {
          break;
        }
      }

      if (myntraPrice) {
        productPrice = myntraPrice.textContent.trim();
      }
    }

    return {
      name: productName,
      price: productPrice,
      image: imageUrl,
      allImages: allImages,
      imageCount: allImages.length,
    };
  }

  /**
   * Inject "Try On" buttons on product cards
   */
  injectButtons() {
    const cardSelectors = this.getProductCardSelectors();
    const imageSelectors = this.getProductImageSelectors();

    console.log('Injecting buttons for site:', this.currentSite);
    console.log('Card selectors:', cardSelectors);
    console.log('Image selectors:', imageSelectors);

    let totalCardsFound = 0;
    let totalButtonsAdded = 0;

    cardSelectors.forEach((cardSelector) => {
      const productCards = document.querySelectorAll(cardSelector);
      console.log(
        `Found ${productCards.length} cards with selector: ${cardSelector}`
      );
      totalCardsFound += productCards.length;

      productCards.forEach((card, index) => {
        if (!card.dataset.styleMeProcessed) {
          console.log(
            `Processing card ${index} with selector: ${cardSelector}`
          );

          // Find the best product image within this card
          const productImage = this.findBestProductImage(card, imageSelectors);
          if (productImage) {
            console.log(
              `Adding button to card ${index}, found image:`,
              productImage.src
            );
            this.addButtonsToProduct(card, productImage);
            card.dataset.styleMeProcessed = 'true';
            totalButtonsAdded++;
          } else {
            console.log(`No suitable image found in card ${index}`);
            // Debug Myntra cards without images
            console.log(`Myntra card ${index} contents:`, {
              hasProductId: card.hasAttribute('data-productid'),
              productIdValue: card.getAttribute('data-productid'),
              hasImages: card.querySelectorAll('img').length,
              imageSources: Array.from(card.querySelectorAll('img')).map(
                (img) => img.src
              ),
              hasTitle: !!card.querySelector(
                '.product-product, .product-name, .product-brand'
              ),
              hasPrice: !!card.querySelector(
                '.product-discountedPrice, .product-price'
              ),
              cardHTML: card.outerHTML.substring(0, 200) + '...',
            });
          }
        } else {
          console.log(`Card ${index} already processed`);
        }
      });
    });

    console.log(
      `Total cards found: ${totalCardsFound}, Total buttons added: ${totalButtonsAdded}`
    );
  }

  /**
   * Find the best product image within a product card
   */
  findBestProductImage(card, imageSelectors) {
    for (const selector of imageSelectors) {
      const images = card.querySelectorAll(selector);
      for (const img of images) {
        // Check if image is visible and has reasonable dimensions
        const rect = img.getBoundingClientRect();
        if (
          rect.width >= 100 &&
          rect.height >= 100 &&
          img.offsetParent !== null &&
          img.style.display !== 'none' &&
          img.style.visibility !== 'hidden'
        ) {
          return img;
        }
      }
    }
    return null;
  }

  /**
   * Add Try On and Save buttons to a product card
   */
  addButtonsToProduct(productCard, productImage) {
    // Ensure the product card has relative positioning
    if (
      !productCard.style.position ||
      productCard.style.position === 'static'
    ) {
      productCard.style.position = 'relative';
    }

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 1000;
    `;

    // Create Try On button
    const tryOnBtn = document.createElement('button');
    tryOnBtn.textContent = 'Try On';
    tryOnBtn.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      transition: all 0.3s ease;
      opacity: 0;
      pointer-events: none;
    `;

    // Add container hover effects to show/hide buttons
    productCard.addEventListener('mouseenter', () => {
      tryOnBtn.style.opacity = '1';
      tryOnBtn.style.pointerEvents = 'auto';
    });

    productCard.addEventListener('mouseleave', () => {
      tryOnBtn.style.opacity = '0';
      tryOnBtn.style.pointerEvents = 'none';
    });

    // Add click handlers
    tryOnBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      this.handleSaveClick(productImage);
    });

    // Add buttons to container
    buttonContainer.appendChild(tryOnBtn);
    productCard.appendChild(buttonContainer);
  }

  /**
   * Handle Save button click
   */
  async handleSaveClick(imgElement) {
    try {
      // Show loading state for product processing
      this.showLoadingToast('Processing product images...');

      const productInfo = await this.getProductInfo(imgElement);

      // Hide loading toast
      this.hideLoadingToast();

      if (!productInfo.image) {
        alert('Could not find product image. Please try again.');
        return;
      }

      console.log('Save clicked for:', productInfo);

      // Add to saved products
      this.addToSavedProducts(productInfo);

      // Show success message
      this.showSuccessToast(
        'Product saved to Try-On! Open sidebar to try it on.'
      );

      // Open sidebar if not already open
      if (!this.sidebarOpen) {
        this.openSidebar();
      }
    } catch (error) {
      // Hide loading toast on error
      this.hideLoadingToast();

      console.error('Error in handleSaveClick:', error);
      alert('Error: ' + error.message);
    }
  }

  /**
   * Add product to saved products
   */
  addToSavedProducts(productInfo) {
    // Check if already exists
    const exists = this.savedProducts.find(
      (p) => p.image === productInfo.image
    );
    if (exists) return;

    this.savedProducts.unshift(productInfo);

    // Keep only last 20 products
    if (this.savedProducts.length > 20) {
      this.savedProducts = this.savedProducts.slice(0, 20);
    }

    this.savePersistentData();
    this.updateSavedProductsList();
  }

  /**
   * Setup mutation observer to detect new product cards
   */
  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldInject = false;
      let newCardsFound = 0;

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const cardSelectors = this.getProductCardSelectors();
              const hasNewCards = cardSelectors.some((selector) => {
                const matches =
                  (node.matches && node.matches(selector)) ||
                  (node.querySelector && node.querySelector(selector));
                if (matches) {
                  console.log(`New cards detected with selector: ${selector}`);
                  newCardsFound++;
                }
                return matches;
              });
              if (hasNewCards) shouldInject = true;
            }
          });
        }
      });

      if (shouldInject) {
        console.log(
          `Mutation observer detected ${newCardsFound} new cards, injecting buttons in 500ms...`
        );
        setTimeout(() => this.injectButtons(), 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    console.log('Mutation observer setup complete');
  }

  /**
   * Setup periodic check to ensure all product cards get buttons
   */
  setupPeriodicCheck() {
    // Check every 2 seconds for the first 10 seconds, then every 5 seconds
    let checkCount = 0;
    const interval = setInterval(() => {
      checkCount++;
      console.log(
        `Periodic check ${checkCount}: Looking for unprocessed cards...`
      );

      const cardSelectors = this.getProductCardSelectors();
      let hasUnprocessedCards = false;

      cardSelectors.forEach((selector) => {
        const cards = document.querySelectorAll(selector);
        const unprocessedCards = Array.from(cards).filter(
          (card) => !card.dataset.styleMeProcessed
        );
        if (unprocessedCards.length > 0) {
          console.log(
            `Found ${unprocessedCards.length} unprocessed cards with selector: ${selector}`
          );
          hasUnprocessedCards = true;
        }
      });

      if (hasUnprocessedCards) {
        console.log('Injecting buttons for unprocessed cards...');
        this.injectButtons();
      }

      // Stop frequent checking after 10 seconds, continue with less frequent checks
      if (checkCount >= 5) {
        clearInterval(interval);
        console.log('Switching to less frequent checks...');

        // Continue checking every 10 seconds
        setInterval(() => {
          console.log('Periodic check: Looking for unprocessed cards...');
          this.injectButtons();
        }, 10000);
      }
    }, 2000);
  }

  /**
   * Open sidebar from the right
   */
  openSidebar() {
    if (this.sidebarOpen) return;

    this.createSidebar();
    this.sidebarOpen = true;
  }

  /**
   * Create and inject sidebar
   */
  createSidebar() {
    // Remove existing sidebar if any
    if (this.sidebar) {
      this.sidebar.remove();
    }

    // Create sidebar container
    this.sidebar = document.createElement('div');
    this.sidebar.id = 'style-me-sidebar';
    this.sidebar.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 400px;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      z-index: 10000;
      box-shadow: -5px 0 20px rgba(0,0,0,0.3);
      transform: translateX(100%);
      transition: transform 0.3s ease;
      overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create sidebar content
    this.sidebar.innerHTML = `
      <div style="padding: 20px;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 24px; font-weight: 700;">✨ Style Me</h2>
          <button id="close-sidebar" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>

        <!-- Settings Section -->
        <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">🔑 Settings</h3>
          
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 500;">OpenRouter API Key:</label>
            <input type="password" id="api-key-input" placeholder="Enter your API key" 
                   style="width: 100%; padding: 10px; border: none; border-radius: 6px; background: rgba(255,255,255,0.9); color: #333; box-sizing: border-box;">
          </div>

          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: 500;">Your Photo:</label>
            <input type="file" id="user-image-input" accept="image/*" 
                   style="width: 100%; padding: 8px; border: none; border-radius: 6px; background: rgba(255,255,255,0.9); color: #333; cursor: pointer; box-sizing: border-box;">
          </div>

          <div id="user-image-preview" style="margin-bottom: 15px; text-align: center;"></div>

          <button id="save-settings" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.2s;">
            💾 Save Settings
          </button>
        </div>

        <!-- Saved Products Section -->
        <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="margin: 0; font-size: 18px; font-weight: 600;">🛍️ Saved Products</h3>
            <div style="display: flex; gap: 10px;">
              <button id="select-all-products" style="padding: 6px 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">
                Select All
              </button>
              <button id="deselect-all-products" style="padding: 6px 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">
                Deselect All
              </button>
            </div>
          </div>
          <div id="saved-products-list"></div>
          
          <!-- Try On Selected Products Button -->
          <div id="try-on-selected-section" style="margin-top: 20px; display: none;">
            <div style="text-align: center; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 8px;">
              <h4 style="margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">🎭 Try On Selected Products</h4>
              <p style="margin: 0 0 15px 0; font-size: 13px; opacity: 0.8;">Generate outfit with all selected products</p>
              <button id="try-on-selected-btn" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; color: white; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.3s ease;">
                ✨ Try On Selected Products
              </button>
            </div>
          </div>
        </div>

        <!-- Generated Results Section -->
        <div id="results-section" style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; margin-top: 20px; display: none;">
          <h3 style="margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">✨ Try-On Result</h3>
          <div id="generated-result"></div>
        </div>
      </div>
    `;

    document.body.appendChild(this.sidebar);

    // Trigger animation
    setTimeout(() => {
      this.sidebar.style.transform = 'translateX(0)';
    }, 10);

    this.setupSidebarEvents();
    this.loadUserSettings();
    this.updateSavedProductsList();
  }

  /**
   * Setup sidebar event listeners
   */
  setupSidebarEvents() {
    // Close button
    const closeBtn = this.sidebar.querySelector('#close-sidebar');
    closeBtn.addEventListener('click', () => this.closeSidebar());

    // File input change
    const fileInput = this.sidebar.querySelector('#user-image-input');
    fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

    // Save settings button
    const saveSettingsBtn = this.sidebar.querySelector('#save-settings');
    if (saveSettingsBtn) {
      console.log('Save settings button found, adding event listener');
      saveSettingsBtn.addEventListener('click', () => {
        console.log('Save settings button clicked');
        this.saveSettings();
      });
    } else {
      console.error('Save settings button not found!');
    }

    // Select all products button
    const selectAllBtn = this.sidebar.querySelector('#select-all-products');
    selectAllBtn.addEventListener('click', () => this.selectAllProducts());

    // Deselect all products button
    const deselectAllBtn = this.sidebar.querySelector('#deselect-all-products');
    deselectAllBtn.addEventListener('click', () => this.deselectAllProducts());

    // Try on selected products button
    const tryOnSelectedBtn = this.sidebar.querySelector('#try-on-selected-btn');
    if (tryOnSelectedBtn) {
      tryOnSelectedBtn.addEventListener('click', () => this.handleTryOnSelectedProducts());
    }

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (this.sidebarOpen && !this.sidebar.contains(e.target)) {
        this.closeSidebar();
      }
    });

    // Prevent sidebar clicks from closing
    this.sidebar.addEventListener('click', (e) => e.stopPropagation());
  }

  /**
   * Close sidebar
   */
  closeSidebar() {
    if (!this.sidebarOpen) return;

    this.sidebar.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (this.sidebar && this.sidebar.parentNode) {
        this.sidebar.remove();
      }
      this.sidebar = null;
      this.sidebarOpen = false;
    }, 300);
  }

  /**
   * Handle file upload for user image
   */
  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const base64 = await this.fileToBase64(file);

      // Show preview
      const preview = this.sidebar.querySelector('#user-image-preview');
      preview.innerHTML = `
        <img src="${base64}" style="max-width: 150px; max-height: 150px; border-radius: 8px; object-fit: cover;">
        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.8;">Image ready for try-on</p>
      `;

      // Store temporarily until saved
      this.tempUserImage = base64;
    } catch (error) {
      alert('Error uploading image: ' + error.message);
    }
  }

  /**
   * Convert file to base64
   */
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Save user settings
   */
  async saveSettings() {
    try {
      console.log('saveSettings method called');

      const apiKeyInput = this.sidebar.querySelector('#api-key-input');
      if (!apiKeyInput) {
        console.error('API key input not found!');
        alert('Error: API key input not found');
        return;
      }

      const apiKey = apiKeyInput.value.trim();
      console.log(
        'Saving settings: API Key:',
        apiKey ? '***' + apiKey.slice(-4) : 'empty'
      );

      if (!apiKey) {
        alert('Please enter your OpenRouter API key');
        return;
      }

      const saveData = { openRouterApiKey: apiKey };
      console.log('Save data prepared:', {
        ...saveData,
        openRouterApiKey: '***' + apiKey.slice(-4),
      });

      if (this.tempUserImage) {
        saveData.userImage = this.tempUserImage;
        console.log('Saving user image from temp storage.');
      } else {
        console.log('No temp user image found.');
      }

      console.log('About to save to chrome.storage.local...');
      await chrome.storage.local.set(saveData);
      console.log('Settings saved successfully to chrome.storage.local');

      this.showSuccessToast('Settings saved successfully!');

      // Clear temp image after successful save
      this.tempUserImage = null;
    } catch (error) {
      console.error('Error in saveSettings:', error);
      alert('Error saving settings: ' + error.message);
    }
  }

  /**
   * Load user settings
   */
  async loadUserSettings() {
    try {
      const result = await chrome.storage.local.get([
        'openRouterApiKey',
        'userImage',
      ]);

      if (result.openRouterApiKey) {
        const apiInput = this.sidebar.querySelector('#api-key-input');
        apiInput.value = result.openRouterApiKey;
      }

      if (result.userImage) {
        const preview = this.sidebar.querySelector('#user-image-preview');
        preview.innerHTML = `
          <img src="${result.userImage}" style="max-width: 150px; max-height: 150px; border-radius: 8px; object-fit: cover;">
          <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.8;">Current photo</p>
        `;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  /**
   * Update saved products list in sidebar
   */
  updateSavedProductsList() {
    if (!this.sidebar) return;

    const container = this.sidebar.querySelector('#saved-products-list');

    if (this.savedProducts.length === 0) {
      container.innerHTML =
        '<p style="text-align: center; opacity: 0.7; margin: 20px 0;">No saved products yet. Click "Try On" on any product!</p>';
      return;
    }

    container.innerHTML = this.savedProducts
      .map(
        (product, index) => `
      <div style="display: flex; align-items: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 8px; margin-bottom: 10px;" data-product-index="${index}">
        <input type="checkbox" class="product-checkbox" data-product-index="${index}" style="margin-right: 12px; transform: scale(1.2); cursor: pointer;">
        <img src="${
          product.imageCount > 1 ? product.allImages[0] : product.image
        }" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; margin-right: 12px;" onerror="this.style.display='none'" title="${
          product.imageCount > 1
            ? 'First image of multiple available'
            : 'Product image'
        }">
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${
            product.name
          }</div>
          ${
            product.price
              ? `<div style="font-size: 12px; opacity: 0.8;">${product.price}</div>`
              : ''
          }
          ${
            product.imageCount > 1
              ? `<div style="font-size: 11px; opacity: 0.7; color: #4ade80;">📸 ${product.imageCount} images (showing first)</div>`
              : ''
          }
        </div>
        <div style="display: flex; gap: 8px; margin-left: 8px;">
          <button class="try-on-btn" data-product-index="${index}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">Try On</button>

          <button class="remove-product-btn" data-product-index="${index}" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 12px;">×</button>
        </div>
      </div>
    `
      )
      .join('');

    // Add event listeners to remove buttons
    this.setupRemoveButtonListeners();

    // Also add event delegation on the container as a fallback
    this.setupContainerEventDelegation();

    // Setup checkbox event listeners
    this.setupCheckboxListeners();

    // Update combined generation section visibility
    this.updateCombinedGenerationVisibility();
  }

  /**
   * Setup event listeners for remove buttons and try-on buttons
   */
  setupRemoveButtonListeners() {
    if (!this.sidebar) return;

    const removeButtons = this.sidebar.querySelectorAll('.remove-product-btn');
    const tryOnButtons = this.sidebar.querySelectorAll('.try-on-btn');

    console.log(
      'Setting up remove button listeners for',
      removeButtons.length,
      'buttons'
    );

    console.log(
      'Setting up try-on button listeners for',
      tryOnButtons.length,
      'buttons'
    );

    removeButtons.forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(button.dataset.productIndex);
        console.log('Remove button clicked for index:', index);
        this.removeProduct(index);
      });
    });

    tryOnButtons.forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(button.dataset.productIndex);
        console.log('Try-on button clicked for index:', index);
        this.handleTryOnClick(index);
      });
    });
  }

  /**
   * Setup container event delegation as a fallback
   */
  setupContainerEventDelegation() {
    if (!this.sidebar) return;

    const container = this.sidebar.querySelector('#saved-products-list');
    if (container) {
      container.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-product-btn')) {
          e.preventDefault();
          e.stopPropagation();
          const index = parseInt(e.target.dataset.productIndex);
          console.log('Remove button clicked via delegation for index:', index);
          this.removeProduct(index);
        } else if (e.target.classList.contains('try-on-btn')) {
          e.preventDefault();
          e.stopPropagation();
          const index = parseInt(e.target.dataset.productIndex);
          console.log('Try-on button clicked via delegation for index:', index);
          this.handleTryOnClick(index);
        }
      });
    }
  }

  /**
   * Remove product from saved list
   */
  removeProduct(index) {
    console.log(
      'Removing product at index:',
      index,
      'from savedProducts:',
      this.savedProducts
    );
    this.savedProducts.splice(index, 1);
    console.log('After removal, savedProducts:', this.savedProducts);
    this.savePersistentData();
    this.updateSavedProductsList();
  }

  /**
   * Handle try-on button click for individual product
   */
  handleTryOnClick(index) {
    if (index >= 0 && index < this.savedProducts.length) {
      const productInfo = this.savedProducts[index];
      console.log('Starting try-on for product:', productInfo);
      this.showLoadingToast('Generating try-on...');
      this.generateOutFit([productInfo]);
    } else {
      console.error('Invalid product index:', index);
    }
  }

  /**
   * Setup checkbox event listeners for product selection
   */
  setupCheckboxListeners() {
    if (!this.sidebar) return;

    const checkboxes = this.sidebar.querySelectorAll('.product-checkbox');
    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        this.updateCombinedGenerationVisibility();
      });
    });
  }

  /**
   * Select all products
   */
  selectAllProducts() {
    if (!this.sidebar) return;

    const checkboxes = this.sidebar.querySelectorAll('.product-checkbox');
    checkboxes.forEach((checkbox) => {
      checkbox.checked = true;
    });
    this.updateCombinedGenerationVisibility();
  }

  /**
   * Deselect all products
   */
  deselectAllProducts() {
    if (!this.sidebar) return;

    const checkboxes = this.sidebar.querySelectorAll('.product-checkbox');
    checkboxes.forEach((checkbox) => {
      checkbox.checked = false;
    });
    this.updateCombinedGenerationVisibility();
  }

  /**
   * Get selected products
   */
  getSelectedProducts() {
    if (!this.sidebar) return [];

    const checkboxes = this.sidebar.querySelectorAll(
      '.product-checkbox:checked'
    );
    const selectedProducts = [];

    checkboxes.forEach((checkbox) => {
      const index = parseInt(checkbox.dataset.productIndex);
      if (this.savedProducts[index]) {
        selectedProducts.push({
          ...this.savedProducts[index],
          index: index,
        });
      }
    });

    return selectedProducts;
  }

  /**
   * Update combined generation section visibility
   */
  updateCombinedGenerationVisibility() {
                                         if (!this.sidebar) return;

                                         const selectedProducts = this.getSelectedProducts();

                                         // Update combined generation section
                                         const combinedSection = this.sidebar.querySelector(
                                           '#combined-generation-section'
                                         );

                                         if (combinedSection) {
                                           if (selectedProducts.length > 0) {
                                             combinedSection.style.display =
                                               'block';
                                           } else {
                                             combinedSection.style.display =
                                               'none';
                                           }
                                         }

                                         // Update try-on selected products section
                                         const tryOnSelectedSection = this.sidebar.querySelector(
                                           '#try-on-selected-section'
                                         );
                                         if (tryOnSelectedSection) {
                                           if (selectedProducts.length > 0) {
                                             tryOnSelectedSection.style.display =
                                               'block';
                                           } else {
                                             tryOnSelectedSection.style.display =
                                               'none';
                                           }
                                         }
                                       }

  /**
   * Converts an image URL to base64 data URL for API submission
   * @param {string} imageUrl - The URL of the image to convert
   * @returns {Promise<string>} - Base64 data URL
   */
  async convertUrlToBase64(imageUrl) {
    try {
      console.log(`Converting image to base64: ${imageUrl}`);

      // Handle remote URLs with fetch
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Convert to base64 using browser-compatible method
      const base64 = btoa(String.fromCharCode(...uint8Array));

      // Determine MIME type from response headers or URL
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

      const result = `data:${mimeType};base64,${base64}`;
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
   * Show combined generation result
   */
  showCombinedResult(generatedImage, selectedProducts) {
    if (!this.sidebar) return;

    // Show results section
    const resultsSection = this.sidebar.querySelector('#results-section');
    const generatedResult = this.sidebar.querySelector('#generated-result');

    if (resultsSection && generatedResult) {
                                             resultsSection.style.display =
                                               'block';

                                             const productNames = selectedProducts
                                               .map((p) => p.name)
                                               .join(', ');

                                             generatedResult.innerHTML = `
        <div style="text-align: center;">
          <h4 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">🎭 Combined Look Generated!</h4>
          <p style="margin: 0 0 15px 0; font-size: 13px; opacity: 0.8;">Products: ${productNames}</p>
          <img src="${generatedImage}" style="width: 100%; max-width: 300px; border-radius: 8px; margin-bottom: 15px;">
          <div style="display: flex; gap: 10px; justify-content: center;">
            <button id="view-full-size-btn" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
              🔍 View Full Size
            </button>
            <button id="copy-url-btn" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
              📋 Copy URL
            </button>
          </div>
        </div>
      `;

                                             // Add event listeners for the buttons
                                             const viewFullSizeBtn = generatedResult.querySelector(
                                               '#view-full-size-btn'
                                             );
                                             const copyUrlBtn = generatedResult.querySelector(
                                               '#copy-url-btn'
                                             );

                                             if (viewFullSizeBtn) {
                                               viewFullSizeBtn.addEventListener(
                                                 'click',
                                                 () =>
                                                   this.viewFullSizeImage(
                                                     generatedImage
                                                   )
                                               );
                                             }

                                             if (copyUrlBtn) {
                                               copyUrlBtn.addEventListener(
                                                 'click',
                                                 async () => {
                                                   try {
                                                     await navigator.clipboard.writeText(
                                                       generatedImage
                                                     );
                                                     this.showSuccessToast(
                                                       'Image URL copied to clipboard!'
                                                     );
                                                   } catch (error) {
                                                     console.error(
                                                       'Failed to copy URL:',
                                                       error
                                                     );
                                                     this.showSuccessToast(
                                                       'Failed to copy URL to clipboard'
                                                     );
                                                   }
                                                 }
                                               );
                                             }
                                           }

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
  }

  /**
   * Get user image from settings
   */
  async getUserImage() {
    return new Promise((resolve) => {
      const userImagePreview = this.sidebar.querySelector(
        '#user-image-preview'
      );
      if (userImagePreview && userImagePreview.querySelector('img')) {
        const img = userImagePreview.querySelector('img');
        resolve(img.src);
      } else {
        resolve(null);
      }
    });
  }

  /**
   * Get API key from settings
   */
  getApiKey() {
    const apiKeyInput = this.sidebar.querySelector('#api-key-input');
    return apiKeyInput ? apiKeyInput.value.trim() : '';
  }

  /**
   * Convert image URL to base64
   */
  async convertImageToBase64(imageUrl) {
    try {
      // Prevent infinite recursion by checking if it's already base64
      if (imageUrl.startsWith('data:image')) {
        console.log('Image is already base64, returning as-is');
        return imageUrl;
      }

      // Check if it's a valid URL
      if (!imageUrl || typeof imageUrl !== 'string') {
        throw new Error('Invalid image URL provided');
      }

      // Check if it's a blob URL (already in memory)
      if (imageUrl.startsWith('blob:')) {
        console.log('Image is a blob URL, returning as-is');
        return imageUrl;
      }

      console.log('Converting image URL to base64:', imageUrl);

      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
      }

      const blob = await response.blob();

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          console.log('Successfully converted image to base64');
          resolve(reader.result);
        };
        reader.onerror = (error) => {
          console.error('FileReader error:', error);
          reject(new Error('Failed to read image data'));
        };
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error converting image to base64:', error);
      throw error;
    }
  }

  /**
   * Load saved products from storage
   */
  async loadSavedProducts() {
    try {
      const result = await chrome.storage.local.get(['savedProducts']);
      if (result.savedProducts) {
        this.savedProducts = result.savedProducts;
      }
    } catch (error) {
      console.error('Error loading saved products:', error);
    }
  }

  /**
   * Save persistent data
   */
  async savePersistentData() {
    try {
      await chrome.storage.local.set({
        savedProducts: this.savedProducts,
      });
    } catch (error) {
      console.error('Error saving persistent data:', error);
    }
  }

  /**
   * Handle successful style generation
   */
  handleStyleSuccess(generatedImage) {
    this.hideLoadingToast();

    // Store the generated image for later use
    this.currentGeneratedImage = generatedImage;

    if (!this.sidebar) {
      this.openSidebar();
      setTimeout(() => this.showGeneratedResult(generatedImage), 300);
    } else {
      this.showGeneratedResult(generatedImage);
    }
  }

  /**
   * Send success response to background script
   */
  sendSuccessToBackground(generatedImage) {
    try {
      chrome.runtime.sendMessage({
        type: 'STYLE_ME_SUCCESS',
        generatedImage: generatedImage,
      });
    } catch (error) {
      console.error('Error sending success to background:', error);
    }
  }

  /**
   * Send error response to background script
   */
  sendErrorToBackground(errorMessage) {
    try {
      chrome.runtime.sendMessage({
        type: 'STYLE_ME_ERROR',
        error: errorMessage,
      });
    } catch (error) {
      console.error('Error sending error to background:', error);
    }
  }

  /**
   * Send message to background script with timeout
   */
  async sendMessageWithTimeout(message, timeoutMs = 10000) {
    try {
      // Add unique request ID
      const requestId = `req_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      message.requestId = requestId;

      // Create a promise that resolves with the response or rejects with timeout
      const messagePromise = chrome.runtime.sendMessage(message);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Message timeout')), timeoutMs);
      });

      // Race between message response and timeout
      const response = await Promise.race([messagePromise, timeoutPromise]);

      // Clean up processed request after a delay to prevent memory leaks
      setTimeout(() => {
        this.processedRequests.delete(requestId);
      }, 60000); // Clean up after 1 minute

      return response;
    } catch (error) {
      console.error('Message timeout or error:', error);
      throw error;
    }
  }

  /**
   * Handle try-on via background script from sidebar
   */
  async generateOutFit(products) {
    try {
      console.log(
        'Sending try-on request to background script from sidebar:',
        products
      );
      // Send request to background script with timeout
      const response = await this.sendMessageWithTimeout(
        {
          type: 'STYLE_ME_CLICKED',
          data: { products: products, userImage: this.currentGeneratedImage },
          source: 'content_script',
        },
        10000
      ); // 10 second timeout

      if (response && response.success) {
        console.log('Background script accepted request');
        // The background script will handle the generation and send back results
        return { success: true };
      }
    } catch (error) {
      console.error('Error sending request to background script:', error);
      // Fall back to local generation
    }
  }

  /**
   * Handle try-on for multiple selected products
   */
  async handleTryOnSelectedProducts() {
    try {
      const selectedProducts = this.getSelectedProducts();
      
      if (selectedProducts.length === 0) {
        this.showSuccessToast('Please select at least one product to try on');
        return;
      }

      console.log('Starting try-on for selected products:', selectedProducts);

      // Show loading state
      this.showLoadingToast('Generating outfit with selected products...');

      // Send to background script for processing
      const response = await this.sendMessageWithTimeout(
        {
          type: 'STYLE_ME_CLICKED',
          data: { 
            products: selectedProducts, 
            userImage: await this.getUserImage()
          },
          source: 'content_script',
        },
        30000 // 30 second timeout for multiple products
      );

      if (response && response.success) {
        console.log('Background script accepted multiple products request');
        this.hideLoadingToast();
        this.showSuccessToast('Try-on request sent! Check the results section.');
      } else {
        throw new Error('Background script rejected request');
      }

    } catch (error) {
      console.error('Error in handleTryOnSelectedProducts:', error);
      this.hideLoadingToast();
      this.showSuccessToast('Failed to process selected products. Please try again.');
    }
  }

  /**
   * Check if a product is already saved
   */
  isProductAlreadySaved(productInfo) {
    return this.savedProducts.some(
      (p) => p.image === productInfo.image || p.name === productInfo.name
    );
  }

  /**
   * Save the current product being viewed
   */
  saveCurrentProduct() {
    if (this.currentProductInfo) {
      this.addToSavedProducts(this.currentProductInfo);
      this.showSuccessToast('Product saved to your collection!');

      // Update the result display to remove the save button
      if (this.currentGeneratedImage) {
        this.showGeneratedResult(
          this.currentGeneratedImage,
          this.currentProductInfo
        );
      }
    }
  }

  /**
   * Handle style generation error
   */
  handleStyleError(error) {
    this.hideLoadingToast();
    alert('Try-on generation failed: ' + error);
  }

  /**
   * Show generated result in sidebar
   */
  showGeneratedResult(generatedImage, productInfo = null) {
                                                            if (!this.sidebar)
                                                              return;

                                                            const resultsSection = this.sidebar.querySelector(
                                                              '#results-section'
                                                            );
                                                            const resultContainer = this.sidebar.querySelector(
                                                              '#generated-result'
                                                            );

                                                            let saveButton = '';
                                                            if (
                                                              productInfo &&
                                                              !this.isProductAlreadySaved(
                                                                productInfo
                                                              )
                                                            ) {
                                                              saveButton = `
        <button id="save-product-btn" 
                style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-right: 10px;">
          💾 Save Product
        </button>
      `;
                                                            }

                                                            resultContainer.innerHTML = `
      <div style="text-align: center;">
        <img src="${generatedImage}" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
        <div style="margin-top: 10px;">
          ${saveButton}
          <button id="view-full-image-btn" 
                  style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-right: 10px;">
            🔍 View Full Image
          </button>
          <button id="share-btn" 
                  style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
            📤 Share
          </button>
        </div>
      </div>
    `;

                                                            // Add event listeners for the buttons
                                                            const viewFullImageBtn = resultContainer.querySelector(
                                                              '#view-full-image-btn'
                                                            );
                                                            const shareBtn = resultContainer.querySelector(
                                                              '#share-btn'
                                                            );
                                                            const saveProductBtn = resultContainer.querySelector(
                                                              '#save-product-btn'
                                                            );

                                                            if (
                                                              viewFullImageBtn
                                                            ) {
                                                              viewFullImageBtn.addEventListener(
                                                                'click',
                                                                () =>
                                                                  this.viewFullSizeImage(
                                                                    generatedImage
                                                                  )
                                                              );
                                                            }

                                                            if (shareBtn) {
                                                              shareBtn.addEventListener(
                                                                'click',
                                                                () =>
                                                                  this.shareImage(
                                                                    generatedImage
                                                                  )
                                                              );
                                                            }

                                                            if (
                                                              saveProductBtn
                                                            ) {
                                                              saveProductBtn.addEventListener(
                                                                'click',
                                                                () =>
                                                                  this.saveCurrentProduct()
                                                              );
                                                            }

                                                            // Store the current product info for the save button
                                                            this.currentProductInfo = productInfo;

                                                            resultsSection.style.display =
                                                              'block';
                                                            resultsSection.scrollIntoView(
                                                              {
                                                                behavior:
                                                                  'smooth',
                                                              }
                                                            );
                                                          }

  /**
   * Download generated image
   */
  downloadImage(imageDataUrl) {
    try {
      // Validate input
      if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        throw new Error('Invalid image data provided');
      }

      // Handle different image formats
      let filename = `style-me-result-${Date.now()}`;
      let mimeType = 'image/png';

      // Determine file type from data URL
      if (imageDataUrl.startsWith('data:image/jpeg')) {
        filename += '.jpg';
        mimeType = 'image/jpeg';
      } else if (imageDataUrl.startsWith('data:image/png')) {
        filename += '.png';
        mimeType = 'image/png';
      } else if (imageDataUrl.startsWith('data:image/webp')) {
        filename += '.webp';
        mimeType = 'image/webp';
      } else if (imageDataUrl.startsWith('data:image/gif')) {
        filename += '.gif';
        mimeType = 'image/gif';
      } else {
        filename += '.png'; // Default to PNG
      }

      // Create blob from data URL
      const byteString = atob(imageDataUrl.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);

      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }

      const blob = new Blob([ab], { type: mimeType });

      // Create download link
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.style.display = 'none';

      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      URL.revokeObjectURL(link.href);

      this.showSuccessToast('Image downloaded successfully!');
      console.log(`Image downloaded: ${filename}`);
    } catch (error) {
      console.error('Error downloading image:', error);

      // Try alternative download method
      try {
        console.log('Trying alternative download method...');
        const link = document.createElement('a');
        link.href = imageDataUrl;
        link.download = `style-me-result-${Date.now()}.png`;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showSuccessToast('Image downloaded using alternative method!');
      } catch (fallbackError) {
        console.error(
          'Alternative download method also failed:',
          fallbackError
        );
        this.showSuccessToast(
          'Failed to download image. Please try right-clicking and "Save As".'
        );
      }
    }
  }

  /**
   * Share generated image
   */
  async shareImage(imageDataUrl) {
    if (navigator.share) {
      try {
        const blob = await fetch(imageDataUrl).then((r) => r.blob());
        const file = new File([blob], 'style-me-result.png', {
          type: 'image/png',
        });

        await navigator.share({
          files: [file],
          title: 'My Virtual Try-On Result',
          text: 'Check out my virtual try-on result from Style Me!',
        });
      } catch (error) {
        console.log('Native sharing failed, using fallback:', error);
        this.fallbackShare(imageDataUrl);
      }
    } else {
      console.log('Native sharing not supported, using fallback');
      this.fallbackShare(imageDataUrl);
    }
  }

  /**
   * Fallback share method
   */
  fallbackShare(imageDataUrl) {
                                // Try to copy the image data URL to clipboard
                                navigator.clipboard
                                  .writeText(imageDataUrl)
                                  .then(() => {
                                    this.showSuccessToast(
                                      'Image data copied to clipboard! You can paste it in any chat or email.'
                                    );
                                  })
                                  .catch((error) => {
                                    console.error(
                                      'Clipboard write failed:',
                                      error
                                    );

                                    // Alternative fallback: create a temporary download link
                                    try {
                                      const link = document.createElement('a');
                                      link.href = imageDataUrl;
                                      link.download = `style-me-share-${Date.now()}.png`;
                                      link.style.display = 'none';

                                      document.body.appendChild(link);
                                      link.click();
                                      document.body.removeChild(link);

                                      this.showSuccessToast(
                                        'Image downloaded for sharing!'
                                      );
                                    } catch (downloadError) {
                                                              console.error(
                                                                'Download fallback also failed:',
                                                                downloadError
                                                              );
                                                              alert(
                                                                'Sharing not supported. You can right-click the image to save it manually.'
                                                              );
                                                            }
                                  });
                              }

  /**
   * Show loading toast
   */
  showLoadingToast(message) {
    this.hideLoadingToast(); // Remove any existing toast

    const toast = document.createElement('div');
    toast.id = 'style-me-loading-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
      animation: slideIn 0.3s ease;
    `;

    toast.innerHTML = `
      <div style="display: flex; align-items: center;">
        <div style="width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 10px;"></div>
        ${message}
      </div>
    `;

    // Add CSS animations
    if (!document.querySelector('#style-me-animations')) {
      const style = document.createElement('style');
      style.id = 'style-me-animations';
      style.textContent = `
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
  }

  /**
   * Hide loading toast
   */
  hideLoadingToast() {
    const toast = document.querySelector('#style-me-loading-toast');
    if (toast) toast.remove();
  }

  /**
   * View full size image in a modal overlay
   */
  viewFullSizeImage(imageDataUrl) {
    try {
      // Remove any existing modal
      const existingModal = document.querySelector('#style-me-image-modal');
      if (existingModal) {
        existingModal.remove();
      }

      // Create modal overlay
      const modal = document.createElement('div');
      modal.id = 'style-me-image-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10002;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
      `;

      // Create image container
      const imageContainer = document.createElement('div');
      imageContainer.style.cssText = `
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
        text-align: center;
      `;

      // Create image element
      const img = document.createElement('img');
      img.src = imageDataUrl;
      img.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      `;

      // Create close button
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '×';
      closeBtn.style.cssText = `
        position: absolute;
        top: -40px;
        right: 0;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 20px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      // Create download button
      const downloadBtn = document.createElement('button');
      downloadBtn.innerHTML = '💾';
      downloadBtn.style.cssText = `
        position: absolute;
        top: -40px;
        left: 0;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      // Add event listeners
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.remove();
      });

      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadImage(imageDataUrl);
      });

      modal.addEventListener('click', () => {
        modal.remove();
      });

      // Prevent image clicks from closing modal
      img.addEventListener('click', (e) => e.stopPropagation());

      // Assemble modal
      imageContainer.appendChild(img);
      imageContainer.appendChild(closeBtn);
      imageContainer.appendChild(downloadBtn);
      modal.appendChild(imageContainer);

      // Add to page
      document.body.appendChild(modal);

      // Add escape key listener
      const escapeHandler = (e) => {
        if (e.key === 'Escape') {
          modal.remove();
          document.removeEventListener('keydown', escapeHandler);
        }
      };
      document.addEventListener('keydown', escapeHandler);

      // Clean up event listener when modal is removed
      modal.addEventListener('remove', () => {
        document.removeEventListener('keydown', escapeHandler);
      });

    } catch (error) {
      console.error('Error showing full size image:', error);
      this.showSuccessToast('Failed to show full size image');
    }
  }

  /**
   * Show success toast
   */
  showSuccessToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #00b894 0%, #00cec9 100%);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
    `;

    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }
}

// Initialize content script
const styleMeContent = new StyleMeContentScript();

// Make it globally accessible for event handlers
window.styleMeContent = styleMeContent;

// Add manual trigger function for debugging
window.forceInjectButtons = () => {
  console.log('Manual button injection triggered');
  styleMeContent.injectButtons();
};

// Add function to check current state
window.checkButtonStatus = () => {
  const cardSelectors = styleMeContent.getProductCardSelectors();
  console.log('Current site:', styleMeContent.currentSite);
  console.log('Card selectors:', cardSelectors);

  cardSelectors.forEach((selector) => {
    const cards = document.querySelectorAll(selector);
    const processedCards = Array.from(cards).filter(
      (card) => card.dataset.styleMeProcessed
    );
    const unprocessedCards = Array.from(cards).filter(
      (card) => !card.dataset.styleMeProcessed
    );

    console.log(`Selector "${selector}":`);
    console.log(`  Total cards: ${cards.length}`);
    console.log(`  Processed: ${processedCards.length}`);
    console.log(`  Unprocessed: ${unprocessedCards.length}`);
  });
};

// Add function to analyze Myntra page structure
window.analyzeMyntraPage = () => {
  console.log('=== Myntra Page Analysis ===');

  // Check for common Myntra elements
  const commonElements = {
    'data-productid elements': document.querySelectorAll('[data-productid]')
      .length,
    '.product-base': document.querySelectorAll('.product-base').length,
    '.product-card': document.querySelectorAll('.product-card').length,
    '.product-tile': document.querySelectorAll('.product-tile').length,
    '.product-image': document.querySelectorAll('.product-image').length,
    '.product-imageSlider': document.querySelectorAll('.product-imageSlider')
      .length,
    'images with myntra domains': document.querySelectorAll(
      'img[src*="assets.myntassets.com"]'
    ).length,
    'images with myntra.com': document.querySelectorAll(
      'img[src*="myntra.com"]'
    ).length,
    'product links': document.querySelectorAll('a[href*="/product/"]').length,
  };

  console.log('Common elements found:', commonElements);

  // Analyze first few product cards in detail
  const firstCards = document
    .querySelectorAll('[data-productid]:not([data-productid=""])')
    .slice(0, 3);
  firstCards.forEach((card, index) => {
    console.log(`\n--- Card ${index + 1} Analysis ---`);
    console.log('Product ID:', card.getAttribute('data-productid'));
    console.log('Classes:', card.className);
    console.log('Has images:', card.querySelectorAll('img').length);
    console.log(
      'Image sources:',
      Array.from(card.querySelectorAll('img')).map((img) => img.src)
    );
    console.log(
      'Has title:',
      !!card.querySelector('.product-product, .product-name, .product-brand')
    );
    console.log(
      'Has price:',
      !!card.querySelector('.product-discountedPrice, .product-price')
    );
    console.log('HTML preview:', card.outerHTML.substring(0, 300) + '...');
  });
};
