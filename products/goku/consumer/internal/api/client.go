package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/fallrising/goku-consumer/pkg/models"
)

type Client struct {
	endpoint string
	client   *http.Client
}

func NewClient(endpoint string) *Client {
	return &Client{
		endpoint: endpoint,
		client:   &http.Client{},
	}
}

func (c *Client) UploadBatch(items []models.URLInfo) error {
	payload, err := json.Marshal(items)
	if err != nil {
		return err
	}

	resp, err := c.client.Post(c.endpoint, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return errors.New("API request failed")
	}

	return nil
}
